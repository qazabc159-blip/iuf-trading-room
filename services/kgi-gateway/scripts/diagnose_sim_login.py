#!/usr/bin/env python3
"""
diagnose_sim_login.py — standalone KGI simulation login diagnostic.

Purpose:
  Directly calls kgisuperpy.login() and prints IsSucceed + ReplyString + error code.
  楊董 Windows machine: run this script to verify whether KGI sim credentials are valid
  WITHOUT starting the full gateway server.

Usage:
  # Using command-line args:
  python diagnose_sim_login.py --person_id A123456789 --password yourpwd

  # Using environment variables (recommended — avoids shell history exposure):
  set KGI_PERSON_ID=A123456789
  set KGI_PASSWORD=yourpwd
  set KGI_SIMULATION=true
  python diagnose_sim_login.py

  # Mixed (CLI overrides env):
  python diagnose_sim_login.py --person_id A123456789

Hard lines:
  - NO credentials hard-coded in this file
  - Credentials read from args or env only
  - person_id masked in output (middle chars replaced with '*')
  - Password NEVER printed in any output
"""

from __future__ import annotations

import argparse
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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="KGI simulation login diagnostic — verify credentials without the full gateway"
    )
    parser.add_argument(
        "--person_id",
        default=os.environ.get("KGI_PERSON_ID", ""),
        help="KGI person ID (or set KGI_PERSON_ID env var)",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("KGI_PASSWORD", ""),
        help="KGI password (or set KGI_PASSWORD env var)",
    )
    parser.add_argument(
        "--simulation",
        action=argparse.BooleanOptionalAction,
        default=os.environ.get("KGI_SIMULATION", "true").lower() in ("true", "1", "yes"),
        help="Use simulation mode (default: True)",
    )
    args = parser.parse_args()

    if not args.person_id:
        print("ERROR: person_id is required. Use --person_id or set KGI_PERSON_ID env var.", file=sys.stderr)
        return 2
    if not args.password:
        print("ERROR: password is required. Use --password or set KGI_PASSWORD env var.", file=sys.stderr)
        return 2

    masked = _mask_person_id(args.person_id)
    print(f"[diagnose_sim_login] person_id={masked}  simulation={args.simulation}")
    print("[diagnose_sim_login] Calling kgisuperpy.login() ...")

    try:
        import kgisuperpy
    except ImportError:
        print(
            "ERROR: kgisuperpy is not installed.\n"
            "  Run: pip install kgisuperpy\n"
            "  (Must be on Windows with KGI SDK dependencies installed)",
            file=sys.stderr,
        )
        return 3

    try:
        result = kgisuperpy.login(
            person_id=args.person_id.upper(),
            person_pwd=args.password,
            simulation=args.simulation,
        )
    except Exception as exc:
        print(f"[diagnose_sim_login] EXCEPTION during kgisuperpy.login(): {type(exc).__name__}: {exc}")
        return 4

    # Inspect the result object
    is_succeed = getattr(result, "IsSucceed", "<attribute missing>")
    rtn_code = getattr(result, "RtnCode", "<attribute missing>")
    reply_string = getattr(result, "ReplyString", "<attribute missing>")

    print(f"[diagnose_sim_login] IsSucceed    = {is_succeed}")
    print(f"[diagnose_sim_login] RtnCode      = {rtn_code}")
    print(f"[diagnose_sim_login] ReplyString  = {reply_string}")

    if is_succeed is True:
        # Safe: call show_account only when IsSucceed=True
        try:
            accounts = result.show_account()
            print(f"[diagnose_sim_login] show_account count = {len(accounts)}")
            for i, a in enumerate(accounts):
                acct = a.get("account", "?") if isinstance(a, dict) else getattr(a, "account", "?")
                flag = a.get("account_flag", "?") if isinstance(a, dict) else getattr(a, "account_flag", "?")
                broker = a.get("broker_id", "?") if isinstance(a, dict) else getattr(a, "broker_id", "?")
                print(f"  [{i}] account=*** account_flag={flag} broker_id=***")
        except Exception as exc:
            print(f"[diagnose_sim_login] show_account() failed: {type(exc).__name__}: {exc}")

        print("[diagnose_sim_login] RESULT: LOGIN SUCCESS")
        return 0

    else:
        print("[diagnose_sim_login] RESULT: LOGIN FAILED (IsSucceed=False)")
        print("[diagnose_sim_login] Check: person_id uppercase? simulation flag correct? credentials valid?")
        return 1


if __name__ == "__main__":
    sys.exit(main())
