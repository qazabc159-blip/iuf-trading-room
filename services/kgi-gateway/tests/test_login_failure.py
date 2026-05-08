"""
test_login_failure.py — unit tests for KGI login error classification.

Original 4 tests (KgiLoginFailedError path):
  1. login_failed_returns_401_not_502
  2. show_account_not_called_on_failed_login
  3. response_code_is_kgi_login_failed
  4. no_credential_in_response_body

New 5 tests (full 3-class error classification):
  5. missing_show_account_attribute_returns_400_not_502
       When login result has no show_account → KgiLoginObjectMissingAttr → 400
       (not 502 vague error)

  6. missing_attr_response_is_kgi_login_object_missing_attr
       Response body error.code == "KGI_LOGIN_OBJECT_MISSING_ATTR"

  7. missing_attr_response_body_redacted
       Response body does NOT contain person_id or password

  8. code_78_returns_kgi_permission_or_credential_rejected_401
       IsSucceed=False + RtnCode=78 → KGI_PERMISSION_OR_CREDENTIAL_REJECTED 401

  9. non_78_failure_code_returns_kgi_login_failed_401
       IsSucceed=False + RtnCode != 78 → KGI_LOGIN_FAILED 401 (not 502)

  10. log_never_contains_password
       Logger never emits raw password string on any error path

Additional actual-SDK regression guards:
  11. _ObjOrder.FIsLogon=False + native code 78 skips show_account
  12. _ObjOrder.FIsLogon=True succeeds without IsSucceed
  13. raw AttributeError maps to redacted KGI_LOGIN_OBJECT_MISSING_ATTR
  14. failed-login reply strings are redacted before logging
"""

from __future__ import annotations

import logging
import sys
import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kgi_session import (
    KgiLoginFailedError,
    KgiLoginObjectMissingAttr,
    KgiPermissionOrCredentialRejected,
    KgiSession,
)


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

    Uses error_code=2 (wrong password, non-78) so the raised exception is
    KgiLoginFailedError (code 78 path now raises KgiPermissionOrCredentialRejected).
    """
    failed_stub = _make_failed_login_result(error_code=2, reply_string="帳號或密碼錯誤")

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


# ---------------------------------------------------------------------------
# Test 5: missing show_account attr → 400 KGI_LOGIN_OBJECT_MISSING_ATTR (not 502)
# ---------------------------------------------------------------------------

def test_missing_show_account_attribute_returns_400_not_502():
    """
    When the login result object has no show_account() method,
    KgiLoginObjectMissingAttr is raised → handler must return 400, NOT 502.

    This is the root cause of the original vague 502 — this test is the
    regression guard that it never returns 502 again for SDK shape mismatch.
    """
    from app import app
    client = TestClient(app)

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginObjectMissingAttr(
            attr_name="'kgisuperpy.KGI' object has no attribute 'show_account'",
        )
        response = client.post(
            "/session/login",
            json={"person_id": "A123456789", "person_pwd": "testpwd", "simulation": True},
        )

    assert response.status_code == 400, (
        f"Expected 400 for SDK shape mismatch, got {response.status_code} "
        f"(was 502 before fix — regression guard)"
    )


# ---------------------------------------------------------------------------
# Test 6: missing attr error code in response body
# ---------------------------------------------------------------------------

def test_missing_attr_response_is_kgi_login_object_missing_attr():
    """
    Response body error.code must be "KGI_LOGIN_OBJECT_MISSING_ATTR"
    when the login result is missing an expected attribute.
    """
    from app import app
    client = TestClient(app)

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginObjectMissingAttr(
            attr_name="show_account",
        )
        response = client.post(
            "/session/login",
            json={"person_id": "A123456789", "person_pwd": "testpwd", "simulation": True},
        )

    body = response.json()
    detail = body.get("detail", body)
    error_obj = detail.get("error") if isinstance(detail, dict) else None
    assert error_obj is not None, f"Response missing 'error' object: {body}"
    assert error_obj["code"] == "KGI_LOGIN_OBJECT_MISSING_ATTR", (
        f"Expected KGI_LOGIN_OBJECT_MISSING_ATTR, got: {error_obj['code']}"
    )


# ---------------------------------------------------------------------------
# Test 7: missing attr response body is redacted (no person_id / password)
# ---------------------------------------------------------------------------

def test_missing_attr_response_body_redacted():
    """
    Even on KGI_LOGIN_OBJECT_MISSING_ATTR, response body must NOT contain
    person_id literal or password.
    """
    from app import app
    client = TestClient(app)

    person_id = "B987654321"
    password = "secret_pass"

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginObjectMissingAttr(
            attr_name="show_account",
        )
        response = client.post(
            "/session/login",
            json={"person_id": person_id, "person_pwd": password, "simulation": True},
        )

    response_text = response.text
    assert person_id not in response_text, (
        f"person_id '{person_id}' leaked in response body on OBJECT_MISSING_ATTR path"
    )
    assert password not in response_text, (
        f"password leaked in response body on OBJECT_MISSING_ATTR path"
    )


# ---------------------------------------------------------------------------
# Test 8: IsSucceed=False + code=78 → KGI_PERMISSION_OR_CREDENTIAL_REJECTED 401
# ---------------------------------------------------------------------------

def test_code_78_returns_permission_rejected_401():
    """
    When kgisuperpy returns IsSucceed=False with RtnCode=78,
    KgiPermissionOrCredentialRejected must be raised → HTTP 401
    with code="KGI_PERMISSION_OR_CREDENTIAL_REJECTED".

    Code 78 = TradeCom 元件使用權限 not enabled — distinct from wrong password.
    """
    from app import app
    client = TestClient(app)

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiPermissionOrCredentialRejected(code=78)
        response = client.post(
            "/session/login",
            json={"person_id": "A123456789", "person_pwd": "testpwd", "simulation": True},
        )

    assert response.status_code == 401, (
        f"Expected 401 for code-78 permission rejection, got {response.status_code}"
    )
    body = response.json()
    detail = body.get("detail", body)
    error_obj = detail.get("error") if isinstance(detail, dict) else None
    assert error_obj is not None, f"Response missing 'error' object: {body}"
    assert error_obj["code"] == "KGI_PERMISSION_OR_CREDENTIAL_REJECTED", (
        f"Expected KGI_PERMISSION_OR_CREDENTIAL_REJECTED, got: {error_obj['code']}"
    )


# ---------------------------------------------------------------------------
# Test 9: non-78 failure code → KGI_LOGIN_FAILED 401 (not 502)
# ---------------------------------------------------------------------------

def test_non_78_failure_code_returns_kgi_login_failed_401():
    """
    IsSucceed=False with a non-78 error code must raise KgiLoginFailedError
    → HTTP 401 KGI_LOGIN_FAILED (not 502 vague error, not 400).

    Covers error codes like 2 (wrong password), 70 (locked), etc.
    """
    session = KgiSession()
    failed_stub = MagicMock(spec=[])
    failed_stub.IsSucceed = False
    failed_stub.RtnCode = 2   # wrong password — NOT code 78
    failed_stub.ReplyString = "帳號或密碼錯誤"

    with patch("kgi_session.kgisuperpy") as mock_kgi:
        mock_kgi.login.return_value = failed_stub
        with pytest.raises(KgiLoginFailedError) as exc_info:
            session.login(person_id="A123456789", person_pwd="wrongpwd", simulation=True)

    assert exc_info.value.error_code == 2, (
        f"Expected error_code=2, got {exc_info.value.error_code}"
    )


# ---------------------------------------------------------------------------
# Test 10: logger never emits raw password string on any error path
# ---------------------------------------------------------------------------

def test_log_never_contains_password(caplog):
    """
    On any login error path, the Python logger must NEVER emit the raw password.
    Uses caplog to capture log records and asserts password is absent.
    """
    import logging as _logging
    from app import app
    client = TestClient(app)

    raw_password = "ultra_secret_password_12345"

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginFailedError(
            error_code=70,
            reply_string="帳號或密碼錯誤",
        )
        with caplog.at_level(_logging.DEBUG, logger="kgi_gateway"):
            response = client.post(
                "/session/login",
                json={
                    "person_id": "A123456789",
                    "person_pwd": raw_password,
                    "simulation": True,
                },
            )

    # Check all captured log records for the raw password
    all_log_text = " ".join(r.getMessage() for r in caplog.records)
    assert raw_password not in all_log_text, (
        f"Raw password found in log output — credential leak in logger!"
    )
    # Also verify response doesn't contain it
    assert raw_password not in response.text, (
        f"Raw password found in HTTP response body — credential leak!"
    )


# ---------------------------------------------------------------------------
# Test 11: actual kgisuperpy failed shape uses _ObjOrder.FIsLogon
# ---------------------------------------------------------------------------

def test_actual_sdk_fislogon_false_code_78_skips_show_account():
    """
    Installed kgisuperpy does not expose IsSucceed/RtnCode on the outer object.
    It exposes _ObjOrder.FIsLogon. When that is False, account methods must not
    be touched, and native TradeCom code 78 maps to the permission bucket.
    """
    failed_stub = MagicMock()
    failed_stub._ObjOrder = MagicMock()
    failed_stub._ObjOrder.FIsLogon = False
    failed_stub.show_account = MagicMock(return_value=[])

    session = KgiSession()
    with patch("kgi_session.kgisuperpy") as mock_kgi, patch(
        "kgi_session._latest_tradecom_login_code", return_value=78
    ):
        mock_kgi.login.return_value = failed_stub
        with pytest.raises(KgiPermissionOrCredentialRejected) as exc_info:
            session.login(person_id="A123456789", person_pwd="wrongpwd", simulation=True)

    assert exc_info.value.error_code == 78
    failed_stub.show_account.assert_not_called()
    assert session.is_logged_in is False


# ---------------------------------------------------------------------------
# Test 12: actual kgisuperpy success shape does not need IsSucceed
# ---------------------------------------------------------------------------

def test_actual_sdk_fislogon_true_succeeds_without_is_succeed():
    """
    A real successful kgisuperpy object exposes _ObjOrder.FIsLogon=True and
    attaches show_account dynamically. That is enough positive confirmation.
    """
    success_stub = MagicMock()
    success_stub._ObjOrder = MagicMock()
    success_stub._ObjOrder.FIsLogon = True
    success_stub.show_account.return_value = [
        {"account": "1234567", "account_flag": "證券", "broker_id": "9A9A"}
    ]

    session = KgiSession()
    with patch("kgi_session.kgisuperpy") as mock_kgi:
        mock_kgi.login.return_value = success_stub
        accounts = session.login(person_id="A123456789", person_pwd="okpwd", simulation=True)

    assert session.is_logged_in is True
    assert accounts[0].account == "1234567"
    success_stub.show_account.assert_called_once()


# ---------------------------------------------------------------------------
# Test 13: raw AttributeError path is redacted and classified
# ---------------------------------------------------------------------------

def test_raw_attribute_error_returns_object_missing_attr_redacted():
    """
    A raw AttributeError escaping the SDK/login layer must not fall through to
    KGI_LOGIN_ERROR. It is an object-shape issue and the response only exposes
    attr=<safe-name>, with no credentials or raw exception text.
    """
    from app import app
    client = TestClient(app)

    person_id = "A123456789"
    password = "raw_attr_password"

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = AttributeError(
            "'kgisuperpy.KGI' object has no attribute 'show_account'"
        )
        response = client.post(
            "/session/login",
            json={"person_id": person_id, "person_pwd": password, "simulation": True},
        )

    assert response.status_code == 400
    body = response.json()
    detail = body.get("detail", body)
    error_obj = detail.get("error") if isinstance(detail, dict) else None
    assert error_obj is not None, f"Response missing 'error' object: {body}"
    assert error_obj["code"] == "KGI_LOGIN_OBJECT_MISSING_ATTR"
    assert error_obj["upstream"] == "attr=show_account"
    assert person_id not in response.text
    assert password not in response.text
    assert "object has no attribute" not in response.text


# ---------------------------------------------------------------------------
# Test 14: failed-login reply strings are redacted before logging
# ---------------------------------------------------------------------------

def test_failed_login_reply_redacted_from_app_logs(caplog):
    """
    If an upstream ReplyString ever echoes sensitive values, app logs must
    redact them before writing the warning record.
    """
    from app import app
    client = TestClient(app)

    person_id = "A123456789"
    password = "log_redaction_password"
    reply = f"KGI rejected person_id={person_id} password={password}"

    with patch("app.session") as mock_session:
        mock_session.login.side_effect = KgiLoginFailedError(
            error_code=2,
            reply_string=reply,
        )
        with caplog.at_level(logging.WARNING, logger="kgi_gateway"):
            response = client.post(
                "/session/login",
                json={"person_id": person_id, "person_pwd": password, "simulation": True},
            )

    all_log_text = " ".join(r.getMessage() for r in caplog.records)
    assert response.status_code == 401
    assert person_id not in all_log_text
    assert password not in all_log_text
    assert person_id not in response.text
    assert password not in response.text
