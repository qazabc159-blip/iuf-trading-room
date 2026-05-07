"""
test_login_failure.py — unit tests for KGI login IsSucceed=False handling.

Tests:
  1. login_failed_returns_401_not_502:
       When session.login() raises KgiLoginFailedError, handler returns 401
       with code=KGI_LOGIN_FAILED (not 502 Bad Gateway).

  2. show_account_not_called_on_failed_login:
       When kgisuperpy.login() returns IsSucceed=False object,
       show_account() is never called on that object.

  3. response_code_is_kgi_login_failed:
       Response body error.code == "KGI_LOGIN_FAILED".

  4. no_credential_in_response_or_log:
       Response body does not contain person_id literal or password substring.
"""

from __future__ import annotations

import logging
import sys
import os
from unittest.mock import MagicMock, patch, call

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kgi_session import KgiLoginFailedError, KgiSession


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_failed_login_result(error_code: int = 78, reply_string: str = "登入失敗：請檢查帳號密碼") -> MagicMock:
    """
    Build a mock object that mimics the kgisuperpy login result when
    IsSucceed=False.  The object intentionally does NOT have show_account —
    calling it should raise AttributeError if reached (which is the bug).
    """
    stub = MagicMock(spec=[])          # spec=[] → no attributes by default
    stub.IsSucceed = False
    stub.RtnCode = error_code
    stub.ReplyString = reply_string
    # Explicitly remove show_account so any accidental call raises AttributeError
    # (MagicMock with spec=[] already does this, but be explicit for test clarity)
    assert not hasattr(stub, "show_account"), "stub must NOT have show_account"
    return stub


def _make_success_login_result(accounts: list) -> MagicMock:
    """
    Build a mock object that mimics a successful kgisuperpy login result.
    """
    stub = MagicMock()
    stub.IsSucceed = True
    stub.show_account.return_value = accounts
    return stub


# ---------------------------------------------------------------------------
# Test 1: failed login → 401, not 502
# ---------------------------------------------------------------------------

def test_login_failed_returns_401_not_502():
    """
    KgiLoginFailedError raised by session.login() must map to HTTP 401,
    NOT the old 502 Bad Gateway.
    """
    from app import app
    client = TestClient(app)

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginFailedError(
            error_code=78,
            reply_string="登入失敗：請檢查帳號密碼",
        )
        response = client.post(
            "/session/login",
            json={"person_id": "A123456789", "person_pwd": "wrongpwd", "simulation": True},
        )

    assert response.status_code == 401, (
        f"Expected 401 for KGI credential rejection, got {response.status_code}"
    )


# ---------------------------------------------------------------------------
# Test 2: show_account must NOT be called on failed login object
# ---------------------------------------------------------------------------

def test_show_account_not_called_on_failed_login():
    """
    When kgisuperpy.login() returns IsSucceed=False, KgiSession.login()
    must NOT call show_account() on the returned object.
    Any call to show_account() on a failed result raises AttributeError in prod.
    """
    failed_stub = _make_failed_login_result(error_code=78)

    session = KgiSession()
    with patch("kgi_session.kgisuperpy") as mock_kgi:
        mock_kgi.login.return_value = failed_stub

        with pytest.raises(KgiLoginFailedError):
            session.login(person_id="A123456789", person_pwd="wrongpwd", simulation=True)

    # Verify show_account was never called on the failed stub
    # (MagicMock with spec=[] would raise AttributeError on any attr access,
    #  but we assert via call tracking on the mock module)
    mock_kgi.login.assert_called_once()
    # The stub itself has no show_account — if code called it, AttributeError would fire
    # and propagate as a test failure above.  Additional explicit assertion:
    assert not hasattr(failed_stub, "show_account"), (
        "failed login stub must not have show_account — if this fails, stub setup is wrong"
    )


# ---------------------------------------------------------------------------
# Test 3: response body error.code == "KGI_LOGIN_FAILED"
# ---------------------------------------------------------------------------

def test_response_error_code_is_kgi_login_failed():
    """
    The JSON response body must carry error.code == "KGI_LOGIN_FAILED".
    """
    from app import app
    client = TestClient(app)

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginFailedError(
            error_code=78,
            reply_string="登入失敗：請檢查帳號密碼",
        )
        response = client.post(
            "/session/login",
            json={"person_id": "A123456789", "person_pwd": "wrongpwd", "simulation": True},
        )

    body = response.json()
    # FastAPI wraps HTTPException.detail under a top-level "detail" key in TestClient responses.
    # The actual ErrorEnvelope is: {"detail": {"error": {"code": "...", ...}}}
    detail = body.get("detail", body)  # tolerate both wrapped and unwrapped shapes
    error_obj = detail.get("error") if isinstance(detail, dict) else None
    assert error_obj is not None, f"Response missing 'error' object: {body}"
    assert error_obj["code"] == "KGI_LOGIN_FAILED", (
        f"Expected KGI_LOGIN_FAILED, got: {error_obj['code']}"
    )


# ---------------------------------------------------------------------------
# Test 4: no person_id or password in response body
# ---------------------------------------------------------------------------

def test_no_credential_in_response_body():
    """
    The HTTP response body must NOT contain the literal person_id or password.
    Credential redaction is a hard security requirement.
    """
    from app import app
    client = TestClient(app)

    person_id = "A123456789"
    password = "pwd"

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginFailedError(
            error_code=78,
            reply_string="登入失敗：請檢查帳號密碼",
        )
        response = client.post(
            "/session/login",
            json={"person_id": person_id, "person_pwd": password, "simulation": True},
        )

    response_text = response.text
    assert person_id not in response_text, (
        f"person_id '{person_id}' found in response body — credential leak!"
    )
    assert password not in response_text, (
        f"password found in response body — credential leak!"
    )
