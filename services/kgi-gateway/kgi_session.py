"""
kgi_session.py — wrap kgisuperpy login / show_account / set_Account lifecycle.

Holds the singleton api handle for the gateway process lifetime.
Thread-safety: login/set_Account are called once at startup or per POST;
quote callbacks run in the kgisuperpy internal thread — gate access with a lock.
"""

from __future__ import annotations

import glob
import logging
import os
import re
import threading
from typing import Optional, Type

import kgisuperpy

from schemas import Account


_CA_ENV_PATCH_ATTR = "_iuf_ca_env_patch_installed"


def _ca_env_values() -> tuple[str, str]:
    ca_path = os.environ.get("KGI_CA_PATH", "").strip()
    ca_pwd = (
        os.environ.get("KGI_CA_PWD", "") or os.environ.get("KGI_CA_PW", "")
    ).strip()
    return ca_path, ca_pwd


def _install_ca_env_patch_for_tradecom_api(tradecom_api_cls: Type[object]) -> bool:
    """
    kgisuperpy normally asks Windows CryptoAPI for the CA cert. If the host
    provides a PFX path + password, inject it immediately before DLL Login().
    """
    original_login = getattr(tradecom_api_cls, "Login", None)
    if not callable(original_login):
        return False
    if getattr(original_login, _CA_ENV_PATCH_ATTR, False):
        return True

    def login_with_ca(self: object, ID: str, Password: str):  # noqa: N803 - SDK API shape
        ca_path, ca_pwd = _ca_env_values()
        if ca_path and ca_pwd:
            set_ca_pfx = getattr(self, "SetCA_PFX", None)
            set_ca_pw = getattr(self, "SetCA_PW", None)
            if callable(set_ca_pfx) and callable(set_ca_pw):
                set_ca_pfx(ca_path)
                set_ca_pw(ca_pwd)
        return original_login(self, ID, Password)

    setattr(login_with_ca, _CA_ENV_PATCH_ATTR, True)
    setattr(login_with_ca, "_iuf_original_login", original_login)
    setattr(tradecom_api_cls, "Login", login_with_ca)
    return True


def _install_ca_env_patch_if_configured(_log: logging.Logger) -> bool:
    ca_path, ca_pwd = _ca_env_values()
    if not ca_path or not ca_pwd:
        return False
    try:
        from kgisuperpy.pushClient.pyTradeCom import TradeComAPI
    except Exception as exc:  # pragma: no cover - depends on host SDK install
        _log.warning(
            "[kgi-session] CA PFX env patch unavailable sdk_import=%s",
            type(exc).__name__,
        )
        return False
    installed = _install_ca_env_patch_for_tradecom_api(TradeComAPI)
    if installed:
        _log.info(
            "[kgi-session] CA PFX env patch installed ca_path_set=%s ca_pwd_set=%s",
            bool(ca_path),
            bool(ca_pwd),
        )
    return installed


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


class KgiLoginTimedOut(Exception):
    """
    Raised when kgisuperpy.login() completes but _ObjOrder.FIsLogon remains None
    after the outer poll timeout (default 25 s).

    Root cause: kgisuperpy 2.0.3 TradeCom.__init__ has its own 10-second poll for
    the DLL OnStatusChanged callback.  If the callback is delayed beyond 10 s, TradeCom
    exits with FIsLogon=None.  Our outer poll adds an additional 25 s window on top
    of TradeCom's own 10 s, giving the DLL callback up to ~35 s total.

    If this error still fires, the DLL is not sending the callback at all — likely a
    network / CA certificate issue rather than a timing problem.

    Maps to HTTP 504 (gateway timeout, retry is safe).
    """

    def __init__(self, elapsed_s: float) -> None:
        self.elapsed_s = elapsed_s
        super().__init__(
            f"KGI login DLL callback did not arrive within {elapsed_s:.1f}s "
            "(KGI_LOGIN_TIMEOUT): check CA certificate and network connectivity"
        )


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
    if candidate.replace("_", "").isalnum() and candidate[:1].isalpha():
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
        _log = logging.getLogger("kgi_session")

        # Log safe diagnostic info (never log password)
        masked_pid = _mask_person_id_for_log(person_id)
        _log.debug(
            "[kgi-session] login attempt simulation=%s person_id=%s pwd_len=%d",
            simulation, masked_pid, len(person_pwd),
        )

        with self._lock:
            _install_ca_env_patch_if_configured(_log)
            login_result = kgisuperpy.login(
                person_id=person_id.upper(),
                person_pwd=person_pwd,
                simulation=simulation,
            )

            # --- Layer 0: outer poll for DLL callback race condition ---
            #
            # kgisuperpy 2.0.3 root cause (confirmed from SDK source):
            #   TradeCom.__init__ polls _ObjOrder.FIsLogon for up to 10 s (timeout=20
            #   iterations × 0.5 s).  If the DLL OnStatusChanged(status=4) callback
            #   fires AFTER TradeCom exits its own poll, _ObjOrder.FIsLogon is still
            #   None when kgisuperpy.login() returns.  main.py then skips binding
            #   show_account, set_Account, etc., and our Layer 2 guard raises
            #   KgiLoginObjectMissingAttr with value_type=NoneType.
            #
            # Fix: after kgisuperpy.login() returns, spin here at 0.3 s intervals
            # for up to POLL_TIMEOUT_S more seconds, giving the DLL callback extra
            # time to fire and set FIsLogon to True/False.
            #
            # This is safe because:
            #   - If FIsLogon is already True/False (normal path), the loop exits
            #     immediately on the first check (elapsed ≈ 0).
            #   - If FIsLogon is still None (race path), we wait up to 25 s more.
            #   - We never call any account method before FIsLogon is positively True.
            #   - Timeout is not a permanent error — KgiLoginTimedOut is retriable.
            import time as _time
            _POLL_INTERVAL_S = 0.3
            _POLL_TIMEOUT_S = 25.0
            _poll_start = _time.monotonic()

            while True:
                login_state, state_attr = _sdk_login_state(login_result)
                if login_state is not None:
                    break
                elapsed = _time.monotonic() - _poll_start
                if elapsed >= _POLL_TIMEOUT_S:
                    _log.error(
                        "[kgi-session] login DLL callback timeout simulation=%s "
                        "person_id=%s elapsed=%.1fs attr=%s",
                        simulation, masked_pid, elapsed, state_attr,
                    )
                    raise KgiLoginTimedOut(elapsed_s=elapsed)
                _time.sleep(_POLL_INTERVAL_S)

            _log.debug(
                "[kgi-session] login poll resolved simulation=%s person_id=%s "
                "state=%s elapsed=%.2fs",
                simulation, masked_pid, login_state,
                _time.monotonic() - _poll_start,
            )

            # --- Layer 1: login-state guard ---
            # Actual kgisuperpy exposes _ObjOrder.FIsLogon, not IsSucceed.
            # Mock/older shapes may expose IsSucceed. Account methods are only
            # allowed after a positive True from one of those known state flags.
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
            if login_state is not True:
                _log.error(
                    "[kgi-session] login not positively confirmed simulation=%s "
                    "person_id=%s attr=%s value_type=%s",
                    simulation, masked_pid, state_attr, type(login_state).__name__,
                )
                raise KgiLoginObjectMissingAttr(attr_name=state_attr)

            # --- Layer 3: get account list ---
            #
            # When the DLL callback races with main.py's FIsLogon check (the bug we
            # just fixed), main.py's `if self._ObjOrder.FIsLogon == True:` block was
            # skipped, so `login_result.show_account` (the public alias) was never
            # bound.  Even if our poll has now confirmed FIsLogon=True, the alias
            # assignment in main.py already ran (with None) and was skipped.
            #
            # Strategy: try the public alias first (normal post-race-fix path or
            # non-race path).  If it is absent or not callable, fall back to the
            # private method directly on _ObjOrder, which is always present once
            # FIsLogon is True (CA.py OnStatusChanged status=4 calls _show_account()
            # before setting FIsLogon=True, populating _list_account).
            raw_accounts = None
            show_account = getattr(login_result, "show_account", None)
            if callable(show_account):
                try:
                    raw_accounts = show_account()
                except AttributeError as e:
                    attr_name = _safe_attr_name(e)
                    _log.warning(
                        "[kgi-session] show_account() raised AttributeError, "
                        "falling back to _ObjOrder._show_account simulation=%s "
                        "person_id=%s attr=%s",
                        simulation, masked_pid, attr_name,
                    )

            if raw_accounts is None:
                # Fallback: call _show_account() directly on TradeCom object.
                # CA.py OnStatusChanged(4) already called this and populated
                # _list_account before setting FIsLogon=True — so _list_account
                # is not empty when we reach here.
                obj_order = getattr(login_result, "_ObjOrder", None)
                inner_show = getattr(obj_order, "_show_account", None) if obj_order is not None else None
                if not callable(inner_show):
                    _log.error(
                        "[kgi-session] both show_account and _ObjOrder._show_account "
                        "unavailable simulation=%s person_id=%s",
                        simulation, masked_pid,
                    )
                    raise KgiLoginObjectMissingAttr(attr_name="show_account")
                _log.info(
                    "[kgi-session] using _ObjOrder._show_account() fallback "
                    "simulation=%s person_id=%s",
                    simulation, masked_pid,
                )
                try:
                    raw_accounts = inner_show()
                except AttributeError as e:
                    attr_name = _safe_attr_name(e)
                    _log.error(
                        "[kgi-session] _ObjOrder._show_account() raised AttributeError "
                        "simulation=%s person_id=%s attr=%s",
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
