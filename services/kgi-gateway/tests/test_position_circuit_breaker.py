"""W2a Candidate F — /position circuit breaker tests.

Tests:
  (a) flag=true  → 503 + body error.code == "POSITION_DISABLED"
  (b) flag=false → existing behaviour preserved (401 NOT_LOGGED_IN, no session in TestClient)

Hard lines:
  - No real KGI login required.
  - No secret in test fixtures.
  - Uses monkeypatch (pytest fixture) so settings revert automatically after each test.
"""
import sys
import os

# Ensure the gateway package root is on sys.path when pytest runs from repo root
_GATEWAY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _GATEWAY_DIR not in sys.path:
    sys.path.insert(0, _GATEWAY_DIR)

import importlib

import config as config_module


def _make_client(monkeypatch, flag: bool):
    """Return a TestClient with POSITION_DISABLED patched to *flag*.

    app is imported AFTER patching so the handler reads the patched value.
    Each call re-imports app to pick up the new flag state — necessary because
    app.py reads settings at call time (not import time), but we explicitly
    reload to avoid stale module cache across parametrised tests.
    """
    monkeypatch.setattr(config_module.settings, "POSITION_DISABLED", flag)
    # Re-import app after patching to ensure the handler closure sees the new setting.
    import app as app_module  # noqa: PLC0415
    importlib.reload(app_module)
    from fastapi.testclient import TestClient  # noqa: PLC0415
    return TestClient(app_module.app, raise_server_exceptions=False)


def test_position_disabled_returns_503(monkeypatch):
    """When KGI_GATEWAY_POSITION_DISABLED=true, GET /position must 503 immediately."""
    client = _make_client(monkeypatch, True)
    r = client.get("/position")
    assert r.status_code == 503, f"Expected 503, got {r.status_code}: {r.text}"
    body = r.json()
    assert "detail" in body, f"Missing 'detail' key in response: {body}"
    assert body["detail"]["error"]["code"] == "POSITION_DISABLED", (
        f"Expected code='POSITION_DISABLED', got: {body}"
    )


def test_position_enabled_proceeds_to_existing_path(monkeypatch):
    """When KGI_GATEWAY_POSITION_DISABLED=false, existing 401 NOT_LOGGED_IN path is preserved.

    The TestClient has no active KGI session, so the handler should fall through to the
    'not session.is_logged_in' check and return 401.  This confirms the breaker does NOT
    alter behaviour when the flag is off.
    """
    client = _make_client(monkeypatch, False)
    r = client.get("/position")
    assert r.status_code == 401, f"Expected 401 NOT_LOGGED_IN, got {r.status_code}: {r.text}"
    body = r.json()
    assert "detail" in body, f"Missing 'detail' key in response: {body}"
    assert body["detail"]["error"]["code"] == "NOT_LOGGED_IN", (
        f"Expected code='NOT_LOGGED_IN', got: {body}"
    )
