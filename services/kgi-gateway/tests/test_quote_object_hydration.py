"""
test_quote_object_hydration.py - regression coverage for kgisuperpy login objects
that are trade-authenticated but missing the read-only `Quote` wrapper.
"""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


def _make_kgisuperpy_stub():
    pkg = types.ModuleType("kgisuperpy")
    qd_pkg = types.ModuleType("kgisuperpy.marketdata.quote_data")
    qd_mod = types.ModuleType("kgisuperpy.marketdata.quote_data.quotedata")
    quote_mod = types.ModuleType("kgisuperpy.Quote")

    class _QuoteData:
        class QuoteVersion:
            v1 = "v1"

    class _Subscribe:
        def __init__(self, auth, count=1):
            self.auth = auth
            self.count = count
            self.Quote = ["lazy-stock-quote-list"]

    def _STKQuoteManager(_quote_list):
        quote = MagicMock()
        quote.set_cb_tick = MagicMock(return_value=None)
        quote.subscribe_tick = MagicMock(return_value="tick_2330")
        quote.set_cb_bidask = MagicMock(return_value=None)
        quote.subscribe_bidask = MagicMock(return_value="bidask_2330")
        return quote

    qd_mod.QuoteData = _QuoteData
    quote_mod.Subscribe = _Subscribe
    quote_mod._STKQuoteManager = _STKQuoteManager

    sys.modules.setdefault("kgisuperpy", pkg)
    sys.modules.setdefault("kgisuperpy.marketdata", types.ModuleType("kgisuperpy.marketdata"))
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data", qd_pkg)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data.quotedata", qd_mod)
    sys.modules.setdefault("kgisuperpy.Quote", quote_mod)


_make_kgisuperpy_stub()

import kgi_quote as kq  # noqa: E402


def _clear_buffers():
    with kq._BUFFER_LOCK:
        kq._TICK_BUFFER.clear()
        kq._BIDASK_LATEST.clear()
        kq._TICK_SUBSCRIBED.clear()
        kq._BIDASK_SUBSCRIBED.clear()


def test_subscribe_tick_hydrates_missing_quote_from_login_auth_token():
    _clear_buffers()
    api = SimpleNamespace(_ObjOrder=SimpleNamespace(_URL=SimpleNamespace(token="dummy-market-token")))
    manager = kq.KgiQuoteManager()

    label = manager.subscribe_tick(api, "2330", odd_lot=False)

    assert label == "tick_2330"
    assert hasattr(api, "Quote"), "missing api.Quote should be hydrated from _ObjOrder._URL"
    api.Quote.set_cb_tick.assert_called_once()
    api.Quote.subscribe_tick.assert_called_once_with("2330", odd_lot=False, version="v1")
    assert kq.is_tick_subscribed("2330") is True


def test_missing_quote_without_market_token_returns_clear_error():
    _clear_buffers()
    api = SimpleNamespace(_ObjOrder=SimpleNamespace(_URL=SimpleNamespace(token="")))
    manager = kq.KgiQuoteManager()

    with pytest.raises(kq.KgiQuoteUnavailableError, match="KGI_QUOTE_AUTH_UNAVAILABLE"):
        manager.subscribe_tick(api, "2330", odd_lot=False)


def test_subscribe_tick_route_returns_503_for_missing_quote_auth():
    _clear_buffers()

    from fastapi.testclient import TestClient
    import app as gateway_app  # noqa: PLC0415
    import config as cfg  # noqa: PLC0415

    original_api = gateway_app.session._api
    original_disabled = cfg.settings.QUOTE_DISABLED
    gateway_app.session._api = SimpleNamespace(_ObjOrder=SimpleNamespace(_URL=SimpleNamespace(token="")))
    cfg.settings.QUOTE_DISABLED = False

    try:
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/tick", json={"symbol": "2330", "odd_lot": False})
    finally:
        gateway_app.session._api = original_api
        cfg.settings.QUOTE_DISABLED = original_disabled

    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "KGI_QUOTE_AUTH_UNAVAILABLE"
