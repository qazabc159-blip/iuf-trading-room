"""
tests/test_order_gate.py — W5b A3: /order/create 409 envelope tests.

Tests that POST /order/create returns 409 NOT_ENABLED_IN_W1 for ANY payload shape,
including empty body, invalid body, valid-shape body, wrong content-type, and over-large body.

T12 finding integration: the original handler used `body: CreateOrderRequest` which caused
Pydantic to return 422 for invalid payloads before the handler ran. This test file verifies
the fix (Option β: body: Optional[Any] = Body(default=None)) so that ANY payload → 409.

Run: PYTHONUTF8=1 python -m pytest tests/test_order_gate.py -v

Hard lines verified:
  - POST /order/create {} → 409 (not 422)
  - POST /order/create <valid-shape> → 409 (not 200)
  - POST /order/create <missing-fields> → 409 (not 422)
  - POST /order/create <over-large-body> → 409
  - GET /order/create → 405 Method Not Allowed (no handler for GET)
  - 409 response always has code="NOT_ENABLED_IN_W1"
  - NO order ever placed in any path
"""

from __future__ import annotations

import sys
import types
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

    qd_mod.QuoteData = _QuoteData
    sys.modules.setdefault("kgisuperpy", pkg)
    sys.modules.setdefault("kgisuperpy.marketdata", md)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data", qd_pkg)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data.quotedata", qd_mod)


_make_kgisuperpy_stub()


# ---------------------------------------------------------------------------
# Shared TestClient fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def order_client():
    """Returns a FastAPI TestClient with QUOTE_DISABLED=false and logged-out session."""
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with patch.object(cfg.settings, "QUOTE_DISABLED", False):
        yield TestClient(gateway_app.app)


# ---------------------------------------------------------------------------
# T12-fix-1: POST /order/create {} (empty body) → 409 NOT_ENABLED_IN_W1
# ---------------------------------------------------------------------------

def test_order_create_empty_body_returns_409(order_client):
    """
    T12 fix: POST /order/create {} must return 409 NOT_ENABLED_IN_W1, NOT 422.
    This is the original T12 finding that triggered A3.
    """
    resp = order_client.post("/order/create", json={})
    assert resp.status_code == 409, (
        f"Expected 409 NOT_ENABLED_IN_W1, got {resp.status_code}. "
        f"Body: {resp.text[:200]}"
    )
    body = resp.json()
    assert body["error"]["code"] == "NOT_ENABLED_IN_W1", (
        f"error.code must be NOT_ENABLED_IN_W1, got: {body.get('error', {}).get('code')}"
    )


# ---------------------------------------------------------------------------
# T12-fix-2: POST /order/create <valid shape> → 409 NOT_ENABLED_IN_W1
# ---------------------------------------------------------------------------

def test_order_create_valid_body_returns_409(order_client):
    """
    Valid-shape body must still return 409 — handler ignores body entirely.
    Hard line: no order is executed even with a syntactically valid request.
    """
    valid_payload = {
        "action": "Buy",
        "symbol": "2330",
        "qty": 1,
        "price": 100.0,
        "time_in_force": "ROD",
        "order_cond": "Cash",
        "odd_lot": False,
        "name": "test",
    }
    resp = order_client.post("/order/create", json=valid_payload)
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "NOT_ENABLED_IN_W1"


# ---------------------------------------------------------------------------
# T12-fix-3: POST /order/create <missing required fields> → 409 NOT_ENABLED_IN_W1
# ---------------------------------------------------------------------------

def test_order_create_missing_fields_returns_409(order_client):
    """
    Partial/invalid body (missing required fields) must return 409, not 422.
    This validates the Option β fix: Pydantic schema no longer runs before handler.
    """
    partial_payload = {"symbol": "2330"}  # missing action, qty
    resp = order_client.post("/order/create", json=partial_payload)
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "NOT_ENABLED_IN_W1"


# ---------------------------------------------------------------------------
# T12-fix-4: POST /order/create <over-large body> → 409 NOT_ENABLED_IN_W1
# ---------------------------------------------------------------------------

def test_order_create_over_large_body_returns_409(order_client):
    """
    Over-large body must return 409, not 413 or 422.
    Handler ignores body — never deserialises it for logic.
    (Note: FastAPI/uvicorn may impose request size limits at server level;
     TestClient bypasses those — this test validates handler-level 409.)
    """
    large_payload = {"padding": "x" * 10_000, "action": "Buy", "symbol": "2330", "qty": 1}
    resp = order_client.post("/order/create", json=large_payload)
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "NOT_ENABLED_IN_W1"


# ---------------------------------------------------------------------------
# T12-fix-5: POST /order/create with null/None body → 409 NOT_ENABLED_IN_W1
# ---------------------------------------------------------------------------

def test_order_create_null_body_returns_409(order_client):
    """
    Null / no body (JSON null) must return 409, not 422.
    FastAPI Body(default=None) allows null body.
    """
    # Send JSON null — valid JSON, deserialises to Python None
    resp = order_client.post("/order/create", content=b"null", headers={"Content-Type": "application/json"})
    assert resp.status_code == 409, f"Expected 409, got {resp.status_code}. Body: {resp.text[:200]}"
    body = resp.json()
    assert body["error"]["code"] == "NOT_ENABLED_IN_W1"


# ---------------------------------------------------------------------------
# T12-fix-6: GET /order/create → 405 Method Not Allowed (not 404)
# ---------------------------------------------------------------------------

def test_order_create_get_returns_405(order_client):
    """
    GET /order/create must return 405 Method Not Allowed.
    This verifies the route IS registered (but only for POST).
    405 is correct; 404 would mean route absent.
    """
    resp = order_client.get("/order/create")
    assert resp.status_code == 405, (
        f"GET /order/create must be 405 Method Not Allowed, got {resp.status_code}"
    )


# ---------------------------------------------------------------------------
# T12-fix-7: 409 envelope shape — full structure validation
# ---------------------------------------------------------------------------

def test_order_create_409_envelope_structure(order_client):
    """
    409 response must have exact ErrorEnvelope shape:
    { "error": { "code": "NOT_ENABLED_IN_W1", "message": str } }
    """
    resp = order_client.post("/order/create", json={"action": "Buy", "symbol": "2330", "qty": 1})
    assert resp.status_code == 409
    body = resp.json()

    assert "error" in body, "response must have top-level 'error' key"
    err = body["error"]
    assert "code" in err, "error must have 'code' field"
    assert "message" in err, "error must have 'message' field"
    assert err["code"] == "NOT_ENABLED_IN_W1"
    assert isinstance(err["message"], str) and len(err["message"]) > 0


# ---------------------------------------------------------------------------
# T12-fix-8: no-order guarantee — static check that handler never calls SDK order fn
# ---------------------------------------------------------------------------

def test_order_create_handler_never_calls_sdk(order_client):
    """
    Verify that POST /order/create does NOT call any KGI SDK order function.
    Monkeypatches session.api.Order.create_order to detect calls.
    """
    order_calls: list[dict] = []

    class _MockOrder:
        @staticmethod
        def create_order(**kwargs):
            order_calls.append(kwargs)
            return {"status": "submitted"}  # should never be called

    class _MockApi:
        Order = _MockOrder()

    import kgi_session

    # KgiSession.api is a read-only @property backed by self._api; patch the backing field.
    # is_logged_in is also @property backed by self._api is not None — patching _api covers both.
    with patch.object(kgi_session.session, "_api", _MockApi()):
        resp = order_client.post("/order/create", json={
            "action": "Buy",
            "symbol": "2330",
            "qty": 1,
        })

    assert resp.status_code == 409
    assert len(order_calls) == 0, (
        f"SDK Order.create_order must NOT be called in W1. Calls: {order_calls}"
    )
