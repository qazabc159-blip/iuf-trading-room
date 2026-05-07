#!/usr/bin/env python3
"""
diagnose_sim_login.py — deep diagnostic for KGI login failure (error code 78).

Purpose:
  Directly calls kgisuperpy.login() and prints full instrumentation:
  - SDK module path + version
  - login() signature + docstring
  - Real success indicator: _ObjOrder.FIsLogon (NOT IsSucceed — see note below)
  - RtnCode + ReplyString from _ObjOrder (TradeCom callback object)
  - Password length (never the password itself)
  - Optionally retries with simulation=False to distinguish sim vs prod rejection

IMPORTANT — password parameter disambiguation:
  kgisuperpy.login() takes `person_pwd`.
  The `person_pwd` maps to KGI TradeCom DLL Login() which uses the
  **電子下單密碼** (e-trading password), NOT the web login password.
  See errMsg.ini for KGI server-side error codes (loaded from current directory).

Error code 78 (from errMsg.ini):
  78 = 您尚未申請使用元件，請洽營業員
  Translation: "You have not applied to use the component. Please contact your broker."
  Meaning: The TradeCom component access permission has NOT been enabled for this account.
  This is SEPARATE from:
    - API application approval (申請狀態 ✓)
    - SuperPy risk disclosure signing (風險預告書 ✓)
  The TradeCom component permission is a SEPARATE backend toggle that KGI must enable.

Usage:
  # Using environment variables (recommended — avoids shell history exposure):
  set KGI_PERSON_ID=A123456789
  set KGI_PASSWORD=yourpwd
  set KGI_SIMULATION=true
  python diagnose_sim_login.py

  # Using command-line args:
  python diagnose_sim_login.py --person_id A123456789 --password yourpwd

  # Also try production (simulation=False) to compare:
  python diagnose_sim_login.py --no-simulation

Hard lines:
  - NO credentials hard-coded in this file
  - Credentials read from args or env only
  - person_id masked in output (middle chars replaced with '*')
  - Password NEVER printed in any output
  - Only password LENGTH is printed (to verify correct password type is being used)
"""

from __future__ import annotations

import argparse
import inspect
import os
import sys


def _mask_person_id(person_id: str) -> str:
    """Mask middle portion of person_id for safe output."""
    pid = str(person_id)
    if len(pid) <= 5:
        return "***"
    keep_head = 3
    keep_tail = 2
    masked_len = len(pid) - keep_head - keep_tail
    return pid[:keep_head] + "*" * masked_len + pid[-keep_tail:]


def _print_sdk_info() -> None:
    """Print SDK module path, version, login signature/docstring."""
    try:
        import kgisuperpy
    except ImportError:
        print("ERROR: kgisuperpy not installed", file=sys.stderr)
        return

    print("=" * 60)
    print("[SDK INFO]")
    print(f"  Module file : {kgisuperpy.__file__}")
    version = getattr(kgisuperpy, "__version__", "<no __version__ attribute>")
    print(f"  Version     : {version}")

    try:
        sig = inspect.signature(kgisuperpy.login.__init__)
        print(f"  login() sig : {sig}")
    except Exception as exc:
        print(f"  login() sig : <error: {exc}>")

    try:
        doc = kgisuperpy.login.__init__.__doc__ or kgisuperpy.login.__doc__ or "<no docstring>"
        # Trim to first 5 lines for readability
        lines = [ln for ln in doc.strip().splitlines() if ln.strip()][:5]
        print(f"  login docstring (first 5 lines):")
        for ln in lines:
            print(f"    {ln}")
    except Exception as exc:
        print(f"  docstring   : <error: {exc}>")
    print("=" * 60)


def _attempt_login(
    person_id: str, password: str, simulation: bool
) -> tuple[bool, int, str, object]:
    """
    Attempt kgisuperpy.login() and return (success, rtn_code, reply_string, raw_result).

    NOTE on success detection:
      The `login` class instance does NOT have `IsSucceed` / `RtnCode` as top-level attrs.
      Those appear in the DLL callback OnLogonResponse(IsSucceed, ReplyString).
      The REAL success indicator is `result._ObjOrder.FIsLogon` (set by CA.py OnStatusChanged).
      We check both for completeness.
    """
    import kgisuperpy

    print(f"\n[LOGIN ATTEMPT] simulation={simulation}")
    print(f"  person_id (masked) : {_mask_person_id(person_id)}")
    print(f"  password length    : {len(password)} chars")
    print(f"  person_id length   : {len(person_id)} chars")
    print(f"  Calling kgisuperpy.login(person_id=..., person_pwd=..., simulation={simulation}) ...")

    try:
        result = kgisuperpy.login(
            person_id=person_id.upper(),
            person_pwd=password,
            simulation=simulation,
        )
    except Exception as exc:
        print(f"  EXCEPTION during login(): {type(exc).__name__}: {exc}")
        return False, -1, str(exc), None

    # --- Primary success indicator: _ObjOrder.FIsLogon (set by DLL callback) ---
    fi_logon = None
    if hasattr(result, "_ObjOrder") and result._ObjOrder is not None:
        fi_logon = getattr(result._ObjOrder, "FIsLogon", "<missing>")
    print(f"\n  _ObjOrder.FIsLogon  = {fi_logon}   <-- PRIMARY success indicator")

    # --- DLL error code from _ObjOrder (if login failed) ---
    rtn_code_on_obj = None
    if hasattr(result, "_ObjOrder") and result._ObjOrder is not None:
        rtn_code_on_obj = getattr(result._ObjOrder, "RtnCode", "<missing>")
    print(f"  _ObjOrder.RtnCode   = {rtn_code_on_obj}")

    # --- Legacy attributes (set by AutoRefresh web-token call, NOT DLL login callback) ---
    # These come from the compiled url.cp311-win_amd64.pyd AutoRefresh object.
    # They reflect the web-token (market data API) login, NOT the TradeCom DLL login.
    is_succeed_top = getattr(result, "IsSucceed", "<attribute missing>")
    rtn_code_top = getattr(result, "RtnCode", "<attribute missing>")
    reply_str_top = getattr(result, "ReplyString", "<attribute missing>")
    print(f"\n  IsSucceed (top-level)   = {is_succeed_top}  <-- web-token layer, NOT DLL login")
    print(f"  RtnCode (top-level)     = {rtn_code_top}")
    print(f"  ReplyString (top-level) = {reply_str_top}")

    # --- Methods present on login object (only assigned on successful DLL login) ---
    has_show_account = hasattr(result, "show_account")
    has_set_account = hasattr(result, "set_Account")
    has_order = hasattr(result, "Order")
    print(f"\n  Has show_account method = {has_show_account}  <-- True only after successful DLL login")
    print(f"  Has set_Account method  = {has_set_account}")
    print(f"  Has Order object        = {has_order}")

    # --- Derive final verdict ---
    if fi_logon is True:
        return True, 0, "Login succeeded", result
    elif fi_logon is False:
        # Extract error code from the DLL's error map if available
        err_code = -1
        err_msg = "登入失敗：請檢查賬號密碼"
        if hasattr(result, "_ObjOrder") and result._ObjOrder is not None:
            obj = result._ObjOrder
            # errorMap is loaded only after successful login (status==4), so won't be here
            # RtnCode may not be on _ObjOrder directly — it comes from OnLogonResponse callback
            # which is status==5: just sets FIsLogon=False
            pass
        # The RtnCode from top-level is the web-token layer code (errMsg.ini [login] section)
        if isinstance(rtn_code_top, int):
            err_code = rtn_code_top
        return False, err_code, reply_str_top if isinstance(reply_str_top, str) else err_msg, result
    else:
        return False, -99, f"FIsLogon={fi_logon} (unexpected)", result


def _load_errmsg_map() -> dict[str, str]:
    """Load errMsg.ini from CWD (same as KGI SDK does)."""
    path = os.path.join(os.getcwd(), "errMsg.ini")
    if not os.path.exists(path):
        # Try the gateway dir
        script_dir = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(os.path.dirname(script_dir), "errMsg.ini")

    err_dict: dict[str, str] = {}
    try:
        with open(path, encoding="utf-8") as f:
            section = ""
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("[") and line.endswith("]"):
                    section = line[1:-1]
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    full_key = f"{section}:{k.strip()}" if section else k.strip()
                    err_dict[k.strip()] = f"[{section}] {v.strip()}" if section == "login" else v.strip()
    except Exception as exc:
        print(f"[errMsg.ini] Could not load: {exc}")
    return err_dict


def _lookup_errmsg(code: int, err_dict: dict[str, str]) -> str:
    return err_dict.get(str(code), "<code not in errMsg.ini>")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "KGI deep login diagnostic — verify credentials + inspect SDK internals\n"
            "Error 78 = 您尚未申請使用元件 (TradeCom component not enabled for account)"
        )
    )
    parser.add_argument(
        "--person_id",
        default=os.environ.get("KGI_PERSON_ID", ""),
        help="KGI person ID (or KGI_PERSON_ID env var)",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("KGI_PASSWORD", ""),
        help="KGI 電子下單密碼 — NOT the web login password (or KGI_PASSWORD env var)",
    )
    parser.add_argument(
        "--simulation",
        action=argparse.BooleanOptionalAction,
        default=os.environ.get("KGI_SIMULATION", "true").lower() in ("true", "1", "yes"),
        help="Use simulation mode (default: True). Use --no-simulation for production.",
    )
    parser.add_argument(
        "--retry-production",
        action="store_true",
        default=False,
        help=(
            "After simulation attempt, also retry with simulation=False. "
            "Same error on both = password issue. "
            "Sim fails / prod succeeds = sim not enabled. "
            "WARNING: production attempt may trigger trading system."
        ),
    )
    args = parser.parse_args()

    if not args.person_id:
        print("ERROR: person_id required. Use --person_id or KGI_PERSON_ID env var.", file=sys.stderr)
        return 2
    if not args.password:
        print("ERROR: password required. Use --password or KGI_PASSWORD env var.", file=sys.stderr)
        return 2

    # Print SDK info
    _print_sdk_info()

    # Load errMsg.ini for code lookup
    print("\n[errMsg.ini] Loading error code map ...")
    err_dict = _load_errmsg_map()
    print(f"  Loaded {len(err_dict)} error codes")

    # --- Critical password type note ---
    print("\n" + "=" * 60)
    print("[PASSWORD TYPE NOTE]")
    print("  kgisuperpy.login() uses person_pwd = KGI 電子下單密碼")
    print("  This is the e-trading password (下單密碼), NOT the web login password.")
    print("  KGI account has 4 password types:")
    print("    1. 網站登入密碼 (web login) — for kgi.com.tw browser login")
    print("    2. 電子下單密碼 (e-trading) — for kgisuperpy.login() ← CORRECT ONE")
    print("    3. 下單確認密碼 (order confirm) — 2nd factor for order submission")
    print("    4. API專用密碼 (if separately set) — some brokers require this")
    print("  If you are using the web login password, login will fail.")
    print("=" * 60)

    # Attempt login
    success, rtn_code, reply_string, _result = _attempt_login(
        person_id=args.person_id,
        password=args.password,
        simulation=args.simulation,
    )

    # Look up error code
    if not success and rtn_code > 0:
        err_meaning = _lookup_errmsg(rtn_code, err_dict)
        print(f"\n[ERROR CODE LOOKUP] {rtn_code} = {err_meaning}")
        if rtn_code == 78:
            print("\n[CODE 78 DIAGNOSIS]")
            print("  Meaning: 您尚未申請使用元件，請洽營業員")
            print("  = 'TradeCom component not enabled for this account'")
            print()
            print("  This is NOT about:")
            print("    - Wrong password (that would be code 2 or 70)")
            print("    - API application not approved (that would be code 79)")
            print("    - Wrong IP (that would be code 66 or 80)")
            print()
            print("  This IS about:")
            print("    - KGI backend has not enabled TradeCom component for your account")
            print("    - SuperPy API approval (code 79) and TradeCom component (code 78)")
            print("      are TWO SEPARATE permissions in KGI backend")
            print("    - You need to ask KGI to enable: '元件使用權限' for your account")
            print()
            print("  Next action: Contact KGI営業員 (broker rep) with the support letter")
            print("    scripts/KGI_SUPPORT_QUESTION_DRAFT.md")
    elif not success:
        print(f"\n[LOGIN FAILED] rtn_code={rtn_code} reply={reply_string}")

    # Optional production retry
    if args.retry_production and args.simulation:
        print("\n" + "=" * 60)
        print("[RETRY] Attempting with simulation=False (production) ...")
        print("WARNING: This is a PRODUCTION login attempt. Hold/orders are NOT affected")
        print("         by login alone, but be aware you are hitting the production system.")
        success_prod, rtn_code_prod, reply_prod, _ = _attempt_login(
            person_id=args.person_id,
            password=args.password,
            simulation=False,
        )
        if rtn_code_prod > 0:
            print(f"\n[PROD ERROR CODE] {rtn_code_prod} = {_lookup_errmsg(rtn_code_prod, err_dict)}")
        if success and not success_prod:
            print("\n[COMPARISON] Sim=OK / Prod=FAIL → production credentials differ")
        elif not success and success_prod:
            print("\n[COMPARISON] Sim=FAIL / Prod=OK → simulation environment not enabled")
        elif rtn_code == rtn_code_prod:
            print(f"\n[COMPARISON] Both sim+prod fail with code {rtn_code} → same root cause")
        else:
            print(f"\n[COMPARISON] Sim={rtn_code} / Prod={rtn_code_prod} → different root causes")

    # Final verdict
    print("\n" + "=" * 60)
    if success:
        print("[RESULT] LOGIN SUCCESS")
        return 0
    else:
        print("[RESULT] LOGIN FAILED")
        print(f"  RtnCode     = {rtn_code}")
        print(f"  ReplyString = {reply_string}")
        print(f"  errMsg.ini  = {_lookup_errmsg(rtn_code, err_dict) if rtn_code > 0 else 'N/A'}")
        print("\n  See scripts/KGI_SUPPORT_QUESTION_DRAFT.md for KGI support letter.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
