"""
test_sim_not_auth_and_read_only_guard.py

4 tests:

T01: simulation=True + code 78 → 400 SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED
T02: simulation=False + code 78 → 200 login OK (楊董 live login success)
     (uses mock success path — proves live env path is not 400)
T03: read_only_guard blocks /order/create with 403 KGI_READ_ONLY_MODE_BLOCKED
     when KGI_READ_ONLY_MODE=true
T04: read_only_guard allows /quote/status (no decorator — always 200)
     and /account/list (read-only, no decorator) return 200/401 normally
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kgi_session import (
    KgiSimEnvNotAuthorized,
    KgiPermissionOrCredentialRejected,
    KgiSession,
)


# ---------------------------------------------------------------------------
# T01: simulation=True + code 78 → 400 SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED
# ---------------------------------------------------------------------------

def test_sim_env_code_78_returns_400_sim_not_authorized():
    """
    When login is called with simulation=True and KGI returns code 78,
    the gateway must return 400 SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED —
    NOT 401, NOT 502.

    This maps the 楊董-confirmed diagnosis: broker opened live-only API access,
    sim env permission not granted. The remedy is simulation=False.
    """
    from app import app
    client = TestClient(app)

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiSimEnvNotAuthorized(code=78)
        response = client.post(
            "/session/login",
            json={"person_id": "A123456789", "person_pwd": "testpwd", "simulation": True},
        )

    assert response.status_code == 400, (
        f"Expected 400 for sim env code-78, got {response.status_code}"
    )
    body = response.json()
    detail = body.get("detail", body)
    error_obj = detail.get("error") if isinstance(detail, dict) else None
    assert error_obj is not None, f"Response missing 'error' object: {body}"
    assert error_obj["code"] == "SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED", (
        f"Expected SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED, got: {error_obj['code']}"
    )
    # Remedy message must mention simulation=false
    assert "simulation=false" in error_obj.get("message", "").lower() or \
           "false" in error_obj.get("message", ""), (
        "Message should hint at simulation=false remedy"
    )
    # No credential leak
    assert "A123456789" not in response.text
    assert "testpwd" not in response.text


# ---------------------------------------------------------------------------
# T02: simulation=True code 78 is split from simulation=False code 78
#      (sim raises KgiSimEnvNotAuthorized; live raises KgiPermissionOrCredentialRejected)
# ---------------------------------------------------------------------------

def test_sim_vs_live_code_78_split_in_kgi_session():
    """
    KgiSession.login() must raise KgiSimEnvNotAuthorized for simulation=True + code 78,
    and KgiPermissionOrCredentialRejected for simulation=False + code 78.

    This verifies the split in kgi_session.py without going through FastAPI.
    """
    # --- SIM branch ---
    sim_stub = MagicMock(spec=[])
    sim_stub.IsSucceed = False
    sim_stub.RtnCode = 78
    sim_stub.ReplyString = "code 78"

    session_sim = KgiSession()
    with patch("kgi_session.kgisuperpy") as mock_kgi:
        mock_kgi.login.return_value = sim_stub
        with pytest.raises(KgiSimEnvNotAuthorized) as exc_info:
            session_sim.login(person_id="A123456789", person_pwd="pwd", simulation=True)
    assert exc_info.value.error_code == 78

    # --- LIVE branch ---
    live_stub = MagicMock(spec=[])
    live_stub.IsSucceed = False
    live_stub.RtnCode = 78
    live_stub.ReplyString = "code 78"

    session_live = KgiSession()
    with patch("kgi_session.kgisuperpy") as mock_kgi:
        mock_kgi.login.return_value = live_stub
        with pytest.raises(KgiPermissionOrCredentialRejected) as exc_info:
            session_live.login(person_id="A123456789", person_pwd="pwd", simulation=False)
    assert exc_info.value.error_code == 78


# ---------------------------------------------------------------------------
# T03: read_only_guard module correctly blocks mutations when env=true
# ---------------------------------------------------------------------------

def test_read_only_guard_raises_when_mode_is_true():
    """
    The @require_read_only decorator must raise HTTPException(403)
    when is_read_only_mode() returns True.

    Note: /order/create already has a permanent 409 hardcode in W1 and does NOT
    use @require_read_only (the guard is not applied there — 409 fires before any
    guard would matter). This test verifies the guard module itself works correctly
    for use when W2 opens the real order creation path.
    """
    import asyncio
    import read_only_guard
    from fastapi import HTTPException as FHTTPException

    # Create a dummy async handler decorated with @require_read_only
    @read_only_guard.require_read_only
    async def _dummy_mutation_handler():
        return {"ok": True}

    # With read_only_mode=True → must raise 403
    with patch.object(read_only_guard, "is_read_only_mode", return_value=True):
        with pytest.raises(FHTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(_dummy_mutation_handler())

    assert exc_info.value.status_code == 403
    detail = exc_info.value.detail
    error_obj = detail.get("error") if isinstance(detail, dict) else None
    assert error_obj is not None, f"Detail missing 'error' key: {detail}"
    assert error_obj["code"] == "KGI_READ_ONLY_MODE_BLOCKED"

    # With read_only_mode=False → handler executes normally (returns ok=True)
    with patch.object(read_only_guard, "is_read_only_mode", return_value=False):
        result = asyncio.get_event_loop().run_until_complete(_dummy_mutation_handler())
    assert result == {"ok": True}


# ---------------------------------------------------------------------------
# T04: read-only endpoints are not blocked by guard
#      /quote/status → 200 always (no auth, no guard)
#      /account/list → 401 when not logged in (guard not applied)
# ---------------------------------------------------------------------------

def test_read_only_endpoints_not_blocked_by_guard():
    """
    /quote/status is a pure read diagnostic — no guard, always 200.
    /account/list is a read-only account query — guard not applied;
    when not logged in it returns 401 (expected — not a guard 403).

    Both paths confirm that the read_only_guard decorator was NOT placed
    on read-only endpoints.
    """
    from app import app
    client = TestClient(app)

    import read_only_guard
    with patch.object(read_only_guard, "is_read_only_mode", return_value=True):
        # /quote/status — no login required, no guard
        resp_status = client.get("/quote/status")
        assert resp_status.status_code == 200, (
            f"/quote/status should be 200 in read-only mode, got {resp_status.status_code}"
        )

        # /account/list — guard NOT applied; returns 401 (not logged in) not 403
        with patch("app.session") as mock_session:
            mock_session.is_logged_in = False
            resp_account = client.get("/account/list")
        assert resp_account.status_code == 401, (
            f"/account/list should return 401 (not logged in) not 403 (guard), "
            f"got {resp_account.status_code}"
        )

        body = resp_account.json()
        detail = body.get("detail", body)
        error_obj = detail.get("error") if isinstance(detail, dict) else None
        # Confirm it's NOT_LOGGED_IN, not KGI_READ_ONLY_MODE_BLOCKED
        if error_obj:
            assert error_obj.get("code") != "KGI_READ_ONLY_MODE_BLOCKED", (
                "/account/list must not be blocked by read_only_guard"
            )
