"""
tests/test_order_gate.py — /order/create 3-gate tests (P0-A 2026-05-13).

Gate 1 (no session)         → 409 NOT_LOGGED_IN
Gate 2 (LIVE session)       → 409 LIVE_ORDER_BLOCKED
Gate 3 (SIM session)        → 200 sim_only=true + SDK called

Run: PYTHONUTF8=1 python -m pytest tests/test_order_gate.py -v

Hard lines verified:
  - logged-out session: ANY payload → 409 NOT_LOGGED_IN (no SDK call)
  - LIVE session: ANY payload → 409 LIVE_ORDER_BLOCKED (no SDK call)
  - SIM session valid payload → 200 sim_only=true (SDK called exactly once)
  - SIM session invalid payload → 422 INVALID_ORDER_REQUEST (no SDK call)
  - GET /order/create → 405 Method Not Allowed
"""

from __future__ import annotations

import sys
import types
from enum import Enum
from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# Minimal kgisuperpy stub (mirrors test_kbar.py — no real SDK required)
# ---------------------------------------------------------------------------

def _make_kgisuperpy_stub():
    pkg = types.ModuleType("kgisuperpy")
    md = types.ModuleType("kgisuperpy.marketdata")
    qd_pkg = types.ModuleType("kgisuperpy.marketdata.quote_data")
    qd_mod = types.ModuleType("kgisuperpy.marketdata.quote_data.quotedata")

    class _QuoteData:
        class QuoteVersion:
            v1 = "v1"

    class Action(Enum):
        Buy = "B"
        Sell = "S"

    class TimeInForce(Enum):
        ROD = 0
        IOC = 1
        FOK = 2

    class OrderCond(Enum):
        CASH = 0
        MARGIN = 3
        SHORT_SELLING = 4
        Lend_SELLING = 6
        MARGIN_DayTrade = 7
        CASH_SELLING = 9

    class PriceType(Enum):
        MKT = "1"
        Reference = 5
        LimitUp = 9
        LimitDown = 1

    class OddLot(Enum):
        Common = 0
        Fixing = 2
        Odd_AfterMarket = 1
        Odd = 4

    pkg.Action = Action
    pkg.TimeInForce = TimeInForce
    pkg.OrderCond = OrderCond
    pkg.PriceType = PriceType
    pkg.OddLot = OddLot

    qd_mod.QuoteData = _QuoteData
    sys.modules.setdefault("kgisuperpy", pkg)
    sys.modules.setdefault("kgisuperpy.marketdata", md)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data", qd_pkg)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data.quotedata", qd_mod)


_make_kgisuperpy_stub()


# ---------------------------------------------------------------------------
# Shared TestClient fixture (logged-out session by default)
# ---------------------------------------------------------------------------

@pytest.fixture
def order_client():
    """FastAPI TestClient with QUOTE_DISABLED=false and logged-out session."""
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with patch.object(cfg.settings, "QUOTE_DISABLED", False):
        yield TestClient(gateway_app.app)


# ---------------------------------------------------------------------------
# Mock SDK helpers — used by Group B (LIVE) + Group C (SIM)
# ---------------------------------------------------------------------------

class _MockOrder:
    """Records every create_order call so tests can assert call count + payload."""
    def __init__(self):
        self.calls: list[dict] = []

    def create_order(self, **kwargs):
        self.calls.append(kwargs)
        return {"status": "submitted", "order_id": "MOCK-0001"}


class _MockApi:
    def __init__(self):
        self.Order = _MockOrder()


def _patch_session(simulation: bool, mock_api: _MockApi):
    """
    Inject mock api handle into the singleton session, set simulation flag.
    Returns a context manager that restores prior state on exit.
    """
    import kgi_session
    return patch.multiple(
        kgi_session.session,
        _api=mock_api,
        _simulation=simulation,
    )


# ===========================================================================
# GROUP A — Gate 1: logged-out session → 409 NOT_LOGGED_IN
# ===========================================================================

def test_a1_empty_body_returns_409_not_logged_in(order_client):
    """Empty body, logged-out session → 409 NOT_LOGGED_IN."""
    resp = order_client.post("/order/create", json={})
    assert resp.status_code == 409, f"got {resp.status_code} body={resp.text[:200]}"
    assert resp.json()["error"]["code"] == "NOT_LOGGED_IN"


def test_a2_valid_body_returns_409_not_logged_in(order_client):
    """Valid-shape body, logged-out session → 409 NOT_LOGGED_IN (body ignored)."""
    valid_payload = {
        "action": "Buy", "symbol": "2330", "qty": 1, "price": 100.0,
        "time_in_force": "ROD", "order_cond": "Cash", "odd_lot": False, "name": "test",
    }
    resp = order_client.post("/order/create", json=valid_payload)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NOT_LOGGED_IN"


def test_a3_missing_fields_returns_409_not_logged_in(order_client):
    """Partial body, logged-out session → 409 NOT_LOGGED_IN (not 422)."""
    resp = order_client.post("/order/create", json={"symbol": "2330"})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NOT_LOGGED_IN"


def test_a4_over_large_body_returns_409_not_logged_in(order_client):
    """Over-large body, logged-out session → 409 NOT_LOGGED_IN."""
    payload = {"padding": "x" * 10_000, "action": "Buy", "symbol": "2330", "qty": 1}
    resp = order_client.post("/order/create", json=payload)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NOT_LOGGED_IN"


def test_a5_null_body_returns_409_not_logged_in(order_client):
    """Null body, logged-out session → 409 NOT_LOGGED_IN."""
    resp = order_client.post(
        "/order/create", content=b"null", headers={"Content-Type": "application/json"}
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NOT_LOGGED_IN"


def test_a6_get_returns_405(order_client):
    """GET /order/create → 405 Method Not Allowed."""
    resp = order_client.get("/order/create")
    assert resp.status_code == 405


def test_a7_envelope_structure(order_client):
    """409 response must match ErrorEnvelope shape."""
    resp = order_client.post(
        "/order/create",
        json={"action": "Buy", "symbol": "2330", "qty": 1},
    )
    assert resp.status_code == 409
    body = resp.json()
    assert "error" in body
    assert "code" in body["error"] and "message" in body["error"]
    assert body["error"]["code"] == "NOT_LOGGED_IN"
    assert isinstance(body["error"]["message"], str) and len(body["error"]["message"]) > 0


def test_a8_no_sdk_call_when_logged_out(order_client):
    """SDK Order.create_order must NEVER be called from a logged-out session."""
    mock_api = _MockApi()
    resp = order_client.post(
        "/order/create",
        json={"action": "Buy", "symbol": "2330", "qty": 1},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NOT_LOGGED_IN"
    assert mock_api.Order.calls == []


# ===========================================================================
# GROUP B — Gate 2: LIVE session → 409 LIVE_ORDER_BLOCKED (permanent)
# ===========================================================================

def test_b1_live_session_valid_body_returns_409_live_blocked(order_client):
    """LIVE session + valid body → 409 LIVE_ORDER_BLOCKED. SDK NOT called."""
    mock_api = _MockApi()
    with _patch_session(simulation=False, mock_api=mock_api):
        resp = order_client.post(
            "/order/create",
            json={"action": "Buy", "symbol": "0050", "qty": 1, "odd_lot": True},
        )
    assert resp.status_code == 409, f"got {resp.status_code} body={resp.text[:200]}"
    assert resp.json()["error"]["code"] == "LIVE_ORDER_BLOCKED"
    assert mock_api.Order.calls == [], "SDK must NOT be called in LIVE session"


def test_b2_live_session_empty_body_returns_409_live_blocked(order_client):
    """LIVE session + empty body → 409 LIVE_ORDER_BLOCKED (gate check before body parse)."""
    mock_api = _MockApi()
    with _patch_session(simulation=False, mock_api=mock_api):
        resp = order_client.post("/order/create", json={})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LIVE_ORDER_BLOCKED"
    assert mock_api.Order.calls == []


def test_b3_live_session_invalid_body_returns_409_live_blocked(order_client):
    """LIVE session + invalid body → 409 LIVE_ORDER_BLOCKED (NOT 422 — gate is earlier)."""
    mock_api = _MockApi()
    with _patch_session(simulation=False, mock_api=mock_api):
        resp = order_client.post("/order/create", json={"foo": "bar"})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LIVE_ORDER_BLOCKED"
    assert mock_api.Order.calls == []


# ===========================================================================
# GROUP C — Gate 3: SIM session → 200 sim_only=true + SDK called
# ===========================================================================

def test_c1_sim_session_valid_0050_oddlot_returns_200_sim_only(order_client):
    """SIM session + valid 0050 odd-lot 1 share → 200 sim_only=true. SDK called once."""
    mock_api = _MockApi()
    with _patch_session(simulation=True, mock_api=mock_api):
        resp = order_client.post(
            "/order/create",
            json={"action": "Buy", "symbol": "0050", "qty": 1, "odd_lot": True},
        )
    assert resp.status_code == 200, f"got {resp.status_code} body={resp.text[:200]}"
    body = resp.json()
    assert body["ok"] is True
    assert body["sim_only"] is True
    assert body["status"] == "accepted"
    assert len(mock_api.Order.calls) == 1
    call = mock_api.Order.calls[0]
    assert getattr(call["action"], "name", None) == "Buy"
    assert call["symbol"] == "0050"
    assert call["qty"] == 1
    assert call["odd_lot"] is True


def test_c2_sim_session_invalid_body_returns_422(order_client):
    """SIM session + invalid body → 422 INVALID_ORDER_REQUEST (validation runs in Gate 3)."""
    mock_api = _MockApi()
    with _patch_session(simulation=True, mock_api=mock_api):
        resp = order_client.post("/order/create", json={"foo": "bar"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_ORDER_REQUEST"
    assert mock_api.Order.calls == [], "SDK must NOT be called when body validation fails"


def test_c3_sim_session_full_normal_lot_payload_returns_200(order_client):
    """SIM session + full normal-lot payload → 200 sim_only=true."""
    mock_api = _MockApi()
    with _patch_session(simulation=True, mock_api=mock_api):
        resp = order_client.post(
            "/order/create",
            json={
                "action": "Sell", "symbol": "2330", "qty": 1, "price": 800.0,
                "time_in_force": "ROD", "order_cond": "Cash", "odd_lot": False,
                "name": "smoke",
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sim_only"] is True
    assert body["status"] == "accepted"
    assert len(mock_api.Order.calls) == 1
    call = mock_api.Order.calls[0]
    assert getattr(call["action"], "name", None) == "Sell"
    assert getattr(call["time_in_force"], "name", None) == "ROD"
    assert getattr(call["order_cond"], "name", None) == "CASH"
    assert call["price"] == 800.0


def test_c4_sim_session_sdk_exception_returns_502(order_client):
    """SIM session + SDK raises → 502 SIM_SDK_ERROR (no leakage of exception details)."""
    class _ExplodingOrder:
        def create_order(self, **kwargs):
            raise RuntimeError("kgi connection lost mid-call SECRETTOKEN")

    class _ExplodingApi:
        def __init__(self):
            self.Order = _ExplodingOrder()

    exploding = _ExplodingApi()
    import kgi_session
    with patch.multiple(kgi_session.session, _api=exploding, _simulation=True):
        resp = order_client.post(
            "/order/create",
            json={"action": "Buy", "symbol": "0050", "qty": 1, "odd_lot": True},
        )
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["code"] == "SIM_SDK_ERROR"
    # Message must NOT echo raw exception text (no SECRETTOKEN leak)
    assert "SECRETTOKEN" not in body["error"]["message"]
