"""
tests/test_quote_auth_status.py

The gateway must expose why SIM quote streaming is blocked without leaking
tokens, account ids, or passwords.
"""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace


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

from kgi_quote import get_quote_auth_status  # noqa: E402


def test_quote_auth_status_disabled():
    status = get_quote_auth_status(
        SimpleNamespace(Quote=object()),
        logged_in=True,
        quote_disabled=True,
    )

    assert status == {
        "quote_auth_available": False,
        "quote_auth_state": "disabled",
        "quote_auth_error_code": "QUOTE_DISABLED",
    }


def test_quote_auth_status_not_logged_in():
    status = get_quote_auth_status(None, logged_in=False, quote_disabled=False)

    assert status == {
        "quote_auth_available": False,
        "quote_auth_state": "not_logged_in",
        "quote_auth_error_code": "KGI_NOT_LOGGED_IN",
    }


def test_quote_auth_status_unavailable_when_login_has_no_quote_or_token():
    api = SimpleNamespace(_ObjOrder=SimpleNamespace(_URL=SimpleNamespace(token=None)))

    status = get_quote_auth_status(api, logged_in=True, quote_disabled=False)

    assert status == {
        "quote_auth_available": False,
        "quote_auth_state": "unavailable",
        "quote_auth_error_code": "KGI_QUOTE_AUTH_UNAVAILABLE",
    }


def test_quote_auth_status_available_when_quote_object_exists():
    api = SimpleNamespace(Quote=object())

    status = get_quote_auth_status(api, logged_in=True, quote_disabled=False)

    assert status == {
        "quote_auth_available": True,
        "quote_auth_state": "available",
        "quote_auth_error_code": None,
    }
