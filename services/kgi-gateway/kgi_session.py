"""
kgi_session.py — wrap kgisuperpy login / show_account / set_Account lifecycle.

Holds the singleton api handle for the gateway process lifetime.
Thread-safety: login/set_Account are called once at startup or per POST;
quote callbacks run in the kgisuperpy internal thread — gate access with a lock.
"""

from __future__ import annotations

import threading
from typing import Optional

import kgisuperpy

from schemas import Account


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------

class KgiLoginFailedError(Exception):
    """
    Raised when kgisuperpy.login() returns an object with IsSucceed=False.
    Carries the KGI error code (int) and the raw ReplyString from the SDK.
    Distinct from unexpected exceptions (AttributeError, network errors, etc.)
    so the HTTP handler can return 401 (auth failure) vs 400 (bad request).
    """

    def __init__(self, error_code: int, reply_string: str) -> None:
        self.error_code = error_code
        self.reply_string = reply_string
        super().__init__(f"KGI login failed (code={error_code}): {reply_string}")


class KgiSession:
    """Singleton holder for the live kgisuperpy API handle."""

    def __init__(self) -> None:
        self._api: Optional[kgisuperpy.KGI] = None
        self._accounts: list[Account] = []
        self._active_account: Optional[str] = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public state queries
    # ------------------------------------------------------------------

    @property
    def is_logged_in(self) -> bool:
        return self._api is not None

    @property
    def is_account_set(self) -> bool:
        return self._active_account is not None

    @property
    def api(self) -> Optional[kgisuperpy.KGI]:
        return self._api

    @property
    def active_account(self) -> Optional[str]:
        return self._active_account

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    def login(self, person_id: str, person_pwd: str, simulation: bool = False) -> list[Account]:
        """
        Call kgisuperpy.login() and cache the api handle + accounts list.
        Returns normalised Account list.

        person_id MUST be uppercase — KGI is case-sensitive.
        Source: feedback_kgi_env_var_uppercase_rule.md

        Raises KgiLoginFailedError when the SDK returns IsSucceed=False.
        CRITICAL: show_account() MUST NOT be called when IsSucceed=False —
        the login object does not carry that method in the failed state.
        """
        import logging
        _log = logging.getLogger("kgi_session")
        _log.debug("[kgi-session] login attempt simulation=%s", simulation)

        with self._lock:
            login_result = kgisuperpy.login(
                person_id=person_id.upper(),
                person_pwd=person_pwd,
                simulation=simulation,
            )

            # --- IsSucceed guard ---
            # When KGI rejects credentials, login() returns an object where
            # IsSucceed=False.  Calling show_account() on that object raises
            # AttributeError (the method does not exist on the failure stub).
            # We must check IsSucceed BEFORE touching any other attribute.
            is_succeed = getattr(login_result, "IsSucceed", None)
            if is_succeed is False:
                error_code = int(getattr(login_result, "RtnCode", -1))
                reply_string = str(getattr(login_result, "ReplyString", "登入失敗"))
                _log.warning(
                    "[kgi-session] login IsSucceed=False error_code=%d reply=%s",
                    error_code,
                    reply_string,
                )
                # Do NOT store the failed api object in self._api.
                # Do NOT call login_result.show_account().
                raise KgiLoginFailedError(error_code=error_code, reply_string=reply_string)

            # Login succeeded — safe to call show_account()
            self._api = login_result
            raw_accounts = login_result.show_account()
            self._accounts = [
                Account(
                    account=a["account"],
                    account_flag=a["account_flag"],
                    broker_id=a["broker_id"],
                )
                for a in raw_accounts
            ]
            self._active_account = None  # reset on re-login
            return self._accounts

    # ------------------------------------------------------------------
    # show_account
    # ------------------------------------------------------------------

    def show_account(self) -> list[Account]:
        """Return cached accounts (populated after login)."""
        return list(self._accounts)

    # ------------------------------------------------------------------
    # set_Account — CRITICAL: only pass the account string
    # ------------------------------------------------------------------

    def set_account(self, account: str) -> tuple[str | None, str | None]:
        """
        Call api.set_Account(account) — only the string, NOT the full dict.
        Source: brokerport_golden_2026-04-23.md §15-16 — "只吃 account 字串"

        Returns (account_flag, broker_id) for the selected account, or (None, None)
        if not found in cached accounts list.

        Raises RuntimeError if not logged in.
        """
        if self._api is None:
            raise RuntimeError("Not logged in. Call POST /session/login first.")

        # Validate input is string (belt-and-suspenders; Pydantic schema already enforces)
        if not isinstance(account, str):
            raise TypeError(
                f"set_account() expects a plain str, got {type(account).__name__}. "
                "Do NOT pass the full account dict."
            )

        with self._lock:
            # kgisuperpy.set_Account only accepts the account string
            self._api.set_Account(account)
            self._active_account = account

        # Find matching metadata
        for a in self._accounts:
            if a.account == account:
                return a.account_flag, a.broker_id
        return None, None

    # ------------------------------------------------------------------
    # logout
    # ------------------------------------------------------------------

    def logout(self) -> None:
        """
        Call api.logout() (kgisuperpy._logout) to tear down the KGI connection,
        then clear the local session state so is_logged_in returns False.

        Safe to call even if already logged out.
        """
        with self._lock:
            if self._api is not None:
                try:
                    self._api.logout()
                except Exception:
                    pass  # best-effort — SDK may raise if already disconnected
            self._api = None
            self._accounts = []
            self._active_account = None


# Module-level singleton — shared across all FastAPI route handlers
session = KgiSession()
