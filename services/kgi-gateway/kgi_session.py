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
        """
        with self._lock:
            api = kgisuperpy.login(
                person_id=person_id.upper(),
                person_pwd=person_pwd,
                simulation=simulation,
            )
            self._api = api
            raw_accounts = api.show_account()
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
