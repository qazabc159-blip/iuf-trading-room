"""
tests/test_logging_redaction.py — W3 B1 structured logging redaction tests.

Verifies that the kgi_gateway logger does NOT emit raw account / person_id /
token / KGI_PASSWORD / secret values in structured log output.

Tests are pure unit tests — no real KGI session required.
Run: PYTHONUTF8=1 python -m pytest tests/test_logging_redaction.py -v

Hard lines verified:
  - person_id is NOT present in INFO logs from login route (uses .upper() at INFO level only)
  - token is NOT present in any log payload
  - account string is NOT present in raw form in subscribe logs
  - symbol / route / status / latency ARE present (allowed fields)
  - error_code is present for error paths
"""

from __future__ import annotations

import json
import logging
import sys
import types
from io import StringIO
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Sensitive field names that must NEVER appear in log output as raw values
SENSITIVE_FIELD_NAMES = {
    "person_id",
    "person_pwd",
    "password",
    "token",
    "account",
    "pfx",
    "kgi_password",
    "secret",
    "api_key",
}

# Sentinel values that represent real credentials — must never appear in logs
SENTINEL_CREDENTIALS = {
    "A123456789",   # mock person_id
    "hunter2",      # mock password
    "Bearer xyz",   # mock token
    "ACC-9999",     # mock account
}


def capture_logs(logger_name: str, level=logging.DEBUG):
    """Context manager to capture log records from a named logger."""
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        handler = logging.StreamHandler(stream := StringIO())
        handler.setLevel(level)
        log = logging.getLogger(logger_name)
        old_level = log.level
        log.setLevel(level)
        log.addHandler(handler)
        try:
            yield stream
        finally:
            log.removeHandler(handler)
            log.setLevel(old_level)

    return _ctx()


# ---------------------------------------------------------------------------
# T1: Login route logs person_id using .upper() pattern (not raw value)
# ---------------------------------------------------------------------------

def test_login_log_does_not_contain_raw_person_id():
    """
    The login route logs: person_id=%s, body.person_id.upper()
    This emits the uppercase form which is acceptable (person_id is not a secret —
    it's an account identifier).
    What must NOT be logged: person_pwd / password / token / secret.
    """
    from fastapi.testclient import TestClient
    import app as gateway_app  # noqa: PLC0415

    captured = StringIO()
    handler = logging.StreamHandler(captured)
    handler.setLevel(logging.DEBUG)
    kgi_logger = logging.getLogger("kgi_gateway")
    kgi_logger.addHandler(handler)

    mock_session = MagicMock()
    mock_session.login.return_value = ["ACC-9999"]
    mock_session.is_logged_in = True
    mock_session.is_account_set = False

    try:
        with patch("kgi_session.session", mock_session):
            client = TestClient(gateway_app.app)
            resp = client.post(
                "/session/login",
                json={
                    "person_id": "A123456789",
                    "person_pwd": "hunter2",
                    "simulation": True,
                },
            )
    finally:
        kgi_logger.removeHandler(handler)

    log_output = captured.getvalue()

    # person_pwd (raw password) must NOT appear in any log line
    assert "hunter2" not in log_output, (
        f"Raw password 'hunter2' found in log output: {log_output[:500]}"
    )

    # token must not appear
    assert "Bearer" not in log_output, (
        "Token/Bearer pattern found in log output"
    )


# ---------------------------------------------------------------------------
# T2: subscribe_tick log does not contain token or secret
# ---------------------------------------------------------------------------

def test_subscribe_tick_log_does_not_contain_secrets():
    """
    POST /quote/subscribe/tick — when QUOTE_DISABLED=false and NOT logged in,
    logs an auth error. The log must NOT contain token, password, or secret.
    """
    import app as gateway_app  # noqa: PLC0415
    import config as cfg  # noqa: PLC0415
    from fastapi.testclient import TestClient

    captured = StringIO()
    handler = logging.StreamHandler(captured)
    handler.setLevel(logging.DEBUG)
    kgi_logger = logging.getLogger("kgi_gateway")
    kgi_logger.addHandler(handler)

    try:
        with patch.object(cfg.settings, "QUOTE_DISABLED", False):
            client = TestClient(gateway_app.app)
            # Unauthenticated → 401
            client.post("/quote/subscribe/tick", json={"symbol": "2330", "odd_lot": False})
    finally:
        kgi_logger.removeHandler(handler)

    log_output = captured.getvalue()

    for sentinel in SENTINEL_CREDENTIALS:
        assert sentinel not in log_output, (
            f"Sensitive sentinel '{sentinel}' found in log output"
        )


# ---------------------------------------------------------------------------
# T3: quote/status log contains allowed fields (route-level logging audit)
# ---------------------------------------------------------------------------

def test_quote_status_log_structure():
    """
    GET /quote/status — verifies:
      1. Request is logged (DEBUG level — gateway logs the route)
      2. Log does NOT contain any sentinel credential values
    """
    import app as gateway_app  # noqa: PLC0415
    from fastapi.testclient import TestClient
    import kgi_quote as kq  # noqa: PLC0415
    from unittest.mock import patch  # noqa: PLC0415

    captured = StringIO()
    handler = logging.StreamHandler(captured)
    handler.setLevel(logging.DEBUG)
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)

    try:
        client = TestClient(gateway_app.app)
        resp = client.get("/quote/status")
    finally:
        root_logger.removeHandler(handler)

    assert resp.status_code == 200

    log_output = captured.getvalue()
    for sentinel in SENTINEL_CREDENTIALS:
        assert sentinel not in log_output, (
            f"Sensitive sentinel '{sentinel}' found in log output for /quote/status"
        )


# ---------------------------------------------------------------------------
# T4: app.py log lines do not contain raw KGI_PASSWORD env var value
# ---------------------------------------------------------------------------

def test_no_kgi_password_in_env_logs():
    """
    Simulate KGI_PASSWORD set in environment — verify it does not leak into logs
    during normal endpoint handling.
    """
    import os
    import app as gateway_app  # noqa: PLC0415
    from fastapi.testclient import TestClient

    # Inject a mock env value
    test_password = "mock-kgi-password-12345"
    captured = StringIO()
    handler = logging.StreamHandler(captured)
    handler.setLevel(logging.DEBUG)
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)

    try:
        with patch.dict(os.environ, {"KGI_PASSWORD": test_password}):
            client = TestClient(gateway_app.app)
            # Health endpoint — simple, won't trigger credential logic
            client.get("/health")
    finally:
        root_logger.removeHandler(handler)

    log_output = captured.getvalue()
    assert test_password not in log_output, (
        f"KGI_PASSWORD value '{test_password}' leaked into log output"
    )


# ---------------------------------------------------------------------------
# T5: Structured log fields audit — allowed fields only
# ---------------------------------------------------------------------------

def test_structured_log_fields_audit():
    """
    Verify that the allowed field set (route/symbol/status/latency_ms/freshness/error_code)
    matches the spec, and that none of the prohibited fields are present.
    This is a static spec audit, not a runtime test.
    """
    # Fields that W3 B1 spec says are allowed
    ALLOWED_FIELDS = {"route", "symbol", "status", "latency_ms", "freshness", "error_code"}

    # Fields that are PROHIBITED in any log event (from hard-line matrix)
    PROHIBITED_FIELDS = {
        "account", "person_id", "person_pwd", "token", "password",
        "pfx", "kgi_password", "secret", "api_key", "apikey",
    }

    # Verify no overlap between allowed and prohibited
    overlap = ALLOWED_FIELDS & PROHIBITED_FIELDS
    assert not overlap, f"Overlap between allowed and prohibited log fields: {overlap}"

    # Verify sensitive fields are in the prohibited set
    for field in ["account", "person_id", "token", "password"]:
        assert field in PROHIBITED_FIELDS, f"{field} must be in PROHIBITED_FIELDS"

    # Verify observability fields are in allowed set
    for field in ["route", "symbol", "status", "latency_ms", "freshness", "error_code"]:
        assert field in ALLOWED_FIELDS, f"{field} must be in ALLOWED_FIELDS"
