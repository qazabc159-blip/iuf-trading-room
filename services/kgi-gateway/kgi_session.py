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
# Custom exceptions — 3 distinct login failure classes
# ---------------------------------------------------------------------------

class KgiLoginFailedError(Exception):
    """
    Raised when kgisuperpy.login() returns IsSucceed=False with a generic
    non-78 error code (wrong password, account locked, etc.).
    Maps to HTTP 401.
    """

    def __init__(self, error_code: int, reply_string: str) -> None:
        self.error_code = error_code
        self.reply_string = reply_string
        super().__init__(f"KGI login failed (code={error_code})")


class KgiPermissionOrCredentialRejected(Exception):
    """
    Raised when kgisuperpy.login() returns IsSucceed=False with error code 78.
    Code 78 = 「您尚未申請使用元件，請洽營業員」(TradeCom 元件使用權限 not enabled).
    Distinct from generic auth failure — action required: contact KGI 業務窗口.
    Maps to HTTP 401.
    """

    def __init__(self, code: int = 78) -> None:
        self.error_code = code
        super().__init__(f"KGI permission/credential rejected (code={code}): TradeCom 元件使用權限未啟用")


class KgiLoginObjectMissingAttr(Exception):
    """
    Raised when kgisuperpy.login() appears to succeed (IsSucceed is not False)
    but the result object is missing an expected attribute (e.g. show_account).
    This indicates an SDK contract violation or unexpected object shape.
    attr_name carries the attribute name from the AttributeError — safe to log
    because it is an attribute name string, NOT a credential value.
    Maps to HTTP 400 (SDK shape issue — not a credential problem).
    """

    def __init__(self, attr_name: str) -> None:
        self.attr_name = _safe_attr_name(attr_name)
        super().__init__(f"KGI login result object missing attribute: {self.attr_name}")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _mask_person_id_for_log(person_id: str) -> str:
    """
    Mask the middle portion of person_id for safe logging.
    e.g. "A123456789" → "A12*****89"
    Keeps first 3 and last 2 chars; replaces middle with '*'.
    For IDs shorter than 6 chars, returns a fixed mask.
    """
    pid = str(person_id)
    if len(pid) <= 5:
        return "***"
    keep_head = 3
    keep_tail = 2
    masked_len = len(pid) - keep_head - keep_tail
    return pid[:keep_head] + "*" * masked_len + pid[-keep_tail:]


def _safe_attr_name(value: object) -> str:
    """
    Return only a plain attribute name for responses/logs.
    AttributeError text may include object reprs; keep the public payload tiny.
    """
    text = str(value)
    marker = "has no attribute "
    if marker in text:
        text = text.rsplit(marker, 1)[1].strip().strip("'\"")
    candidate = text.strip().strip("'\"")
    if candidate.replace("_", "").isalnum() and candidate[:1].isalpha():
        return candidate[:64]
    return "unknown"


def _safe_int(value: object, default: int = -1) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _redact_sensitive_text(text: object, *secrets: object) -> str:
    safe = str(text)
    for secret in secrets:
        if secret is None:
            continue
        value = str(secret)
        if not value:
            continue
        safe = safe.replace(value, "[REDACTED]")
        safe = safe.replace(value.upper(), "[REDACTED]")
    return safe


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

        Raises:
          KgiPermissionOrCredentialRejected — IsSucceed=False AND RtnCode=78
          KgiLoginFailedError               — IsSucceed=False AND RtnCode != 78
          KgiLoginObjectMissingAttr         — IsSucceed is not False but show_account missing

        CRITICAL: show_account() MUST NOT be called when IsSucceed=False —
        the login object does not carry that method in the failed state.
        POSITIVE CONFIRMATION GUARD: even on apparent success, verify show_account
        exists before calling it to avoid AttributeError on unexpected SDK shapes.
        """
        import logging
        _log = logging.getLogger("kgi_session")

        # Log safe diagnostic info (never log password)
        masked_pid = _mask_person_id_for_log(person_id)
        _log.debug(
            "[kgi-session] login attempt simulation=%s person_id=%s pwd_len=%d",
            simulation, masked_pid, len(person_pwd),
        )

        with self._lock:
            login_result = kgisuperpy.login(
                person_id=person_id.upper(),
                person_pwd=person_pwd,
                simulation=simulation,
            )

            # --- Layer 1: IsSucceed guard ---
            # When KGI rejects credentials, login() returns an object where
            # IsSucceed=False.  Calling show_account() on that object raises
            # AttributeError (the method does not exist on the failure stub).
            # We must check IsSucceed BEFORE touching any other attribute.
            missing = object()
            is_succeed = getattr(login_result, "IsSucceed", missing)
            if is_succeed is missing:
                _log.error(
                    "[kgi-session] login result missing attribute simulation=%s "
                    "person_id=%s attr=%s",
                    simulation, masked_pid, "IsSucceed",
                )
                raise KgiLoginObjectMissingAttr(attr_name="IsSucceed")

            if is_succeed is False:
                error_code = _safe_int(getattr(login_result, "RtnCode", -1))
                reply_string = str(getattr(login_result, "ReplyString", "登入失敗"))
                safe_reply = _redact_sensitive_text(reply_string, person_id, person_pwd)
                # Log safe diagnostic fields (no password, masked person_id)
                _log.warning(
                    "[kgi-session] login IsSucceed=False simulation=%s person_id=%s "
                    "error_code=%d reply=%s",
                    simulation, masked_pid, error_code, safe_reply,
                )
                # Do NOT store the failed api object in self._api.
                # Do NOT call login_result.show_account().
                if error_code == 78:
                    raise KgiPermissionOrCredentialRejected(code=error_code)
                raise KgiLoginFailedError(error_code=error_code, reply_string=reply_string)

            # --- Layer 2: Positive confirmation guard ---
            # Only a positive True allows account methods. Anything else is a
            # half-login or unexpected SDK shape, so show_account stays untouched.
            if is_succeed is not True:
                _log.error(
                    "[kgi-session] login not positively confirmed simulation=%s "
                    "person_id=%s attr=%s value_type=%s",
                    simulation, masked_pid, "IsSucceed", type(is_succeed).__name__,
                )
                raise KgiLoginObjectMissingAttr(attr_name="IsSucceed")

            show_account = getattr(login_result, "show_account", None)
            if not callable(show_account):
                _log.error(
                    "[kgi-session] login result missing callable simulation=%s "
                    "person_id=%s attr=%s",
                    simulation, masked_pid, "show_account",
                )
                raise KgiLoginObjectMissingAttr(attr_name="show_account")

            try:
                raw_accounts = show_account()
            except AttributeError as e:
                attr_name = _safe_attr_name(e)
                _log.error(
                    "[kgi-session] login result missing attribute simulation=%s "
                    "person_id=%s attr=%s",
                    simulation, masked_pid, attr_name,
                )
                raise KgiLoginObjectMissingAttr(attr_name=attr_name) from e

            # Login fully succeeded — cache the api handle
            self._api = login_result
            self._accounts = [
                Account(
                    account=a["account"],
                    account_flag=a["account_flag"],
                    broker_id=a["broker_id"],
                )
                for a in raw_accounts
            ]
            self._active_account = None  # reset on re-login
            _log.info(
                "[kgi-session] login OK simulation=%s person_id=%s accounts=%d",
                simulation, masked_pid, len(self._accounts),
            )
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
