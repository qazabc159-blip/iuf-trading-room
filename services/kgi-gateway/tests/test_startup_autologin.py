"""
Regression coverage for gateway startup auto-login.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock


def test_auto_login_from_env_sets_first_returned_account(monkeypatch):
    import app as gateway_app

    fake_api = object()
    fake_session = SimpleNamespace(api=fake_api)
    fake_session.login = MagicMock(
        return_value=[SimpleNamespace(account="SIM-ACCOUNT-1", account_flag="證券", broker_id="9228")]
    )
    fake_session.set_account = MagicMock(return_value=("證券", "9228"))
    attach = MagicMock()

    monkeypatch.setattr(gateway_app, "session", fake_session)
    monkeypatch.setattr(gateway_app.order_event_manager, "attach", attach)
    monkeypatch.setattr(gateway_app.settings, "AUTO_LOGIN", True)
    monkeypatch.setattr(gateway_app.settings, "KGI_PERSON_ID", "UNIT_TEST_PERSON")
    monkeypatch.setattr(gateway_app.settings, "KGI_PERSON_PWD", "unit-test-password")
    monkeypatch.setattr(gateway_app.settings, "SIMULATION", True)
    monkeypatch.setattr(gateway_app.settings, "KGI_ACCOUNT", "")

    gateway_app._auto_login_from_env()

    fake_session.login.assert_called_once_with(
        person_id="UNIT_TEST_PERSON",
        person_pwd="unit-test-password",
        simulation=True,
    )
    fake_session.set_account.assert_called_once_with("SIM-ACCOUNT-1")
    attach.assert_called_once_with(fake_api)

