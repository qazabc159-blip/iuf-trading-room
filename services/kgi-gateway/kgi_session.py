"""
kgi_session.py — wrap kgisuperpy login / show_account / set_Account lifecycle.

Holds the singleton api handle for the gateway process lifetime.
Thread-safety: login/set_Account are called once at startup or per POST;
quote callbacks run in the kgisuperpy internal thread — gate access with a lock.
"""

from __future__ import annotations

import glob
import os
import re
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
    Raised when kgisuperpy.login() returns IsSucceed=False with error code 78
    on the LIVE (simulation=False) environment.
    Code 78 = 「您尚未申請使用元件，請洽營業員」(TradeCom 元件使用權限 not enabled).
    Distinct from generic auth failure — action required: contact KGI 業務窗口.
    Maps to HTTP 401.
    """

    def __init__(self, code: int = 78) -> None:
        self.error_code = code
        super().__init__(f"KGI permission/credential rejected (code={code}): TradeCom 元件使用權限未啟用")


class KgiSimEnvNotAuthorized(Exception):
    """
    Raised when kgisuperpy.login() returns IsSucceed=False with error code 78
    on the SIMULATION (simulation=True) environment.
    This is NOT a credential error — it means the sim-env TradeCom permission
    has not been granted (broker may only have opened live API access, not sim).
    Action: use simulation=False (live, read-only) instead.
    Maps to HTTP 400 SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED.
    """

    def __init__(self, code: int = 78) -> None:
        self.error_code = code
        super().__init__(
            f"KGI sim-env not authorized (code={code}): "
            "測試環境權限未開或不同步，請改用 simulation=false 正式環境（read-only only）"
        )


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
    text = str(value)
    marker = "has no attribute "
    if marker in text:
        text = text.rsplit(marker, 1)[1].strip().strip("'\"")
    candidate = text.strip().strip("'\"")
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,63}", candidate):
        return candidate[:64]
    return "unknown"


def _safe_int(value: object, default: int = -1) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"-?\d+", text):
            return int(text)
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


def _latest_tradecom_login_code(person_id: str) -> int:
    """
    kgisuperpy exposes login success as _ObjOrder.FIsLogon, but the native
    TradeCom code (for example 78) is only written to its rotating log.
    Best-effort parse; failures fall back to -1 without leaking log content.
    """
    try:
        push_dir = os.path.join(os.path.dirname(kgisuperpy.__file__), "pushClient")
        pattern = os.path.join(push_dir, f"TradeCom.*-{person_id.upper()}_*.log")
        paths = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    except OSError:
        return -1

    code_pattern = re.compile(r"Login Failed\s*\.\.\.\s*\((\d+)\)")
    for path in paths[:5]:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as handle:
                content = handle.read()
        except OSError:
            continue
        matches = code_pattern.findall(content)
        if matches:
            return _safe_int(matches[-1])
    return -1


def _sdk_login_state(login_result: object) -> tuple[object, str]:
    """
    Support both the actual kgisuperpy shape (_ObjOrder.FIsLogon) and older
    test/mocked shapes (IsSucceed).
    """
    missing = object()
    obj_order = getattr(login_result, "_ObjOrder", missing)
    if obj_order is not missing:
        f_is_logon = getattr(obj_order, "FIsLogon", missing)
        if f_is_logon is not missing:
            return f_is_logon, "_ObjOrder.FIsLogon"

    is_succeed = getattr(login_result, "IsSucceed", missing)
    if is_succeed is not missing:
        return is_succeed, "IsSucceed"

    return missing, "_ObjOrder.FIsLogon"


class KgiSession:
    """Singleton holder for the live kgisuperpy API handle."""

    def __init__(self) -> None:
        self._api: Optional[kgisuperpy.KGI] = None
        self._accounts: list[Account] = []
        self._active_account: Optional[str] = None
        self._simulation: Optional[bool] = None
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

    @property
    def is_simulation(self) -> Optional[bool]:
        return self._simulation

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

            # --- Layer 1: login-state guard ---
            # Actual kgisuperpy exposes _ObjOrder.FIsLogon, not IsSucceed.
            # Mock/older shapes may expose IsSucceed. Account methods are only
            # allowed after a positive True from one of those known state flags.
            login_state, state_attr = _sdk_login_state(login_result)
            if login_state is False:
                error_code = _safe_int(getattr(login_result, "RtnCode", -1))
                if error_code == -1 and state_attr == "_ObjOrder.FIsLogon":
                    error_code = _latest_tradecom_login_code(person_id)
                reply_string = str(getattr(login_result, "ReplyString", "登入失敗"))
                safe_reply = _redact_sensitive_text(reply_string, person_id, person_pwd)
                # Log safe diagnostic fields (no password, masked person_id)
                _log.warning(
                    "[kgi-session] login rejected state_attr=%s simulation=%s person_id=%s "
                    "error_code=%d reply=%s",
                    state_attr, simulation, masked_pid, error_code, safe_reply,
                )
                # Do NOT store the failed api object in self._api.
                # Do NOT call login_result.show_account() or any account method.
                if error_code == 78:
                    # sim vs live split: same code 78, different root cause and remedy.
                    # simulation=True → SIM env permission not granted (use live instead).
                    # simulation=False → live TradeCom 元件使用權限 not enabled (contact 業務窗口).
                    if simulation:
                        raise KgiSimEnvNotAuthorized(code=error_code)
                    raise KgiPermissionOrCredentialRejected(code=error_code)
                raise KgiLoginFailedError(error_code=error_code, reply_string=reply_string)

            # --- Layer 2: Positive confirmation guard ---
            show_account = getattr(login_result, "show_account", None)
            if login_state is not True:
                if callable(show_account):
                    # Some kgisuperpy builds attach account methods after a
                    # successful login but do not expose _ObjOrder.FIsLogon /
                    # IsSucceed on the outer object. The official diagnostic
                    # script treats show_account presence as success-only, so
                    # allow this shape instead of blocking SIM login.
                    _log.warning(
                        "[kgi-session] accepting login without state flag because show_account is callable "
                        "simulation=%s person_id=%s missing_attr=%s",
                        simulation, masked_pid, state_attr,
                    )
                else:
                    _log.error(
                        "[kgi-session] login not positively confirmed simulation=%s "
                        "person_id=%s attr=%s value_type=%s",
                        simulation, masked_pid, state_attr, type(login_state).__name__,
                    )
                    raise KgiLoginObjectMissingAttr(attr_name=state_attr)

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
            self._simulation = simulation
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
            self._simulation = None


# Module-level singleton — shared across all FastAPI route handlers
session = KgiSession()
