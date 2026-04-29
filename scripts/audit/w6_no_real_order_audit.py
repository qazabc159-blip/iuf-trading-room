#!/usr/bin/env python3
"""
W6 Paper Sprint — No-Real-Order Audit Script
=============================================
Continuous gate: run on every commit / PR to ensure no real orders are possible.

Exit 0  → AUDIT PASS — 6 checks green
Exit 1  → AUDIT FAIL — see output for which check failed, file:line, reason

Usage (from repo root):
  python3 scripts/audit/w6_no_real_order_audit.py

CI: .github/workflows/ci.yml job w6_audit runs this automatically.

W6 stop-line mapping:
  Check 1 → stop-line 1 (/order/create must 409)
  Check 2 → stop-line 2 (no KGI SDK import in paper path)
  Check 3 → stop-line 3 (no executionMode: 'live' default)
  Check 4 → stop-line 4 (kill switch default ON = mode: trading, engaged: false)
  Check 5 → stop-line 5 (paper mode default OFF = NEXT_PUBLIC_IUF_ORDER_UI_ENABLED=false)
  Check 6 → stop-line 8 (no secret/credential committed)
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent


def fail(check_num: int, check_name: str, details: list[str]) -> None:
    print(f"\n[FAIL] Check {check_num}: {check_name}")
    for d in details:
        print(f"  >> {d}")


def run_audit() -> bool:
    """Returns True if all checks pass."""
    all_pass = True
    results: list[tuple[int, str, str]] = []  # (check_num, status, summary)

    # -----------------------------------------------------------------------
    # Check 1: /order/create always 409 + NOT_ENABLED_IN_W1 invariant
    # -----------------------------------------------------------------------
    C1_TARGET = REPO_ROOT / "services" / "kgi-gateway" / "app.py"
    c1_pass = False
    c1_failures: list[str] = []

    if not C1_TARGET.exists():
        c1_failures.append(f"{C1_TARGET}: file not found")
    else:
        content = C1_TARGET.read_text(encoding="utf-8")
        if "status_code=409" not in content and "status_code = 409" not in content:
            c1_failures.append(f"{C1_TARGET}: no 'status_code=409' found")
        if "NOT_ENABLED_IN_W1" not in content:
            c1_failures.append(f"{C1_TARGET}: literal 'NOT_ENABLED_IN_W1' not found")
        if "@app.post(\"/order/create\")" not in content:
            c1_failures.append(f"{C1_TARGET}: route @app.post('/order/create') not found")
        # Verify the route handler returns 409 — look for the pattern within 30 lines
        # of the route decorator
        lines = content.splitlines()
        route_line = None
        for i, line in enumerate(lines):
            if '@app.post("/order/create")' in line:
                route_line = i
                break
        if route_line is not None:
            window = "\n".join(lines[route_line:route_line + 30])
            if "409" not in window:
                c1_failures.append(
                    f"{C1_TARGET}:{route_line + 1}: 409 not found within 30 lines of route handler"
                )
            if "NOT_ENABLED_IN_W1" not in window:
                c1_failures.append(
                    f"{C1_TARGET}:{route_line + 1}: NOT_ENABLED_IN_W1 not found within 30 lines of route handler"
                )
        if not c1_failures:
            c1_pass = True

    if c1_pass:
        results.append((1, "PASS", "/order/create always 409 + NOT_ENABLED_IN_W1"))
    else:
        all_pass = False
        fail(1, "/order/create 409 invariant", c1_failures)
        results.append((1, "FAIL", "/order/create 409 invariant"))

    # -----------------------------------------------------------------------
    # Check 2: No KGI SDK import in paper path
    # Jason Day 1 will create apps/api/src/domain/trading/ — scan if it exists.
    # Also scan apps/api/src/ broadly for any paper-path files importing KGI SDK.
    # -----------------------------------------------------------------------
    KGI_SDK_PATTERNS = [
        r"kgisuperpy",
        r"import shioaji",
        r"from shioaji",
        r"kgi-broker",
        r"TaiFexCom",
        r"tradecom",
    ]
    PAPER_PATH_CANDIDATES = [
        REPO_ROOT / "apps" / "api" / "src" / "domain" / "trading",
        REPO_ROOT / "apps" / "api" / "src" / "paper-trading",
        REPO_ROOT / "apps" / "api" / "src" / "paper",
    ]

    c2_failures: list[str] = []
    for paper_dir in PAPER_PATH_CANDIDATES:
        if not paper_dir.exists():
            continue
        for f in paper_dir.rglob("*"):
            if not f.is_file():
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for pattern in KGI_SDK_PATTERNS:
                for i, line in enumerate(text.splitlines(), 1):
                    if re.search(pattern, line) and not line.strip().startswith(("//", "#", "*")):
                        c2_failures.append(
                            f"{f}:{i}: KGI SDK pattern '{pattern}' found in paper path"
                        )

    # If paper path doesn't exist yet, that is PASS (Jason hasn't built it yet)
    if not c2_failures:
        results.append((2, "PASS", "No KGI SDK import in paper path (paper path not yet created or clean)"))
    else:
        all_pass = False
        fail(2, "No KGI SDK import in paper path", c2_failures)
        results.append((2, "FAIL", "KGI SDK import in paper path"))

    # -----------------------------------------------------------------------
    # Check 3: No executionMode: 'live' default in defaults / env templates
    # -----------------------------------------------------------------------
    EXEC_MODE_PATTERN = re.compile(
        r"""executionMode\s*[:=]\s*['"]live['"]|EXECUTION_MODE\s*=\s*live""",
        re.IGNORECASE
    )
    # Excluded: test files, documentation
    EXEC_EXCLUDE = {".md", ".txt"}
    c3_failures: list[str] = []

    # Scan env examples and default config files
    scan_roots = [
        REPO_ROOT / ".env.example",
        REPO_ROOT / "apps" / "api" / "src",
        REPO_ROOT / "apps" / "web",
        REPO_ROOT / "packages",
    ]
    for root in scan_roots:
        if root.is_file():
            files = [root]
        elif root.is_dir():
            files = list(root.rglob("*"))
        else:
            continue
        for f in files:
            if not f.is_file():
                continue
            if f.suffix in EXEC_EXCLUDE:
                continue
            if "test" in f.name.lower() and "spec" in f.name.lower():
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if EXEC_MODE_PATTERN.search(line):
                    # Exclude comment-only lines
                    stripped = line.strip()
                    if stripped.startswith(("//", "#", "*", "/*")):
                        continue
                    c3_failures.append(
                        f"{f}:{i}: executionMode 'live' default — {line.strip()[:80]}"
                    )

    if not c3_failures:
        results.append((3, "PASS", "No executionMode: 'live' default found"))
    else:
        all_pass = False
        fail(3, "No executionMode: 'live' default", c3_failures)
        results.append((3, "FAIL", "executionMode: 'live' default found"))

    # -----------------------------------------------------------------------
    # Check 4: Kill switch default is NOT engaged (mode: 'trading', engaged: false)
    # In IUF semantics: kill switch "ON" = functional and ready (not tripped).
    # defaultKillSwitch() must return mode='trading', engaged=false.
    # -----------------------------------------------------------------------
    C4_TARGET = REPO_ROOT / "apps" / "api" / "src" / "risk-engine.ts"
    c4_pass = False
    c4_failures: list[str] = []

    if not C4_TARGET.exists():
        c4_failures.append(f"{C4_TARGET}: file not found")
    else:
        content = C4_TARGET.read_text(encoding="utf-8")
        lines = content.splitlines()
        # Find defaultKillSwitch function
        func_start = None
        for i, line in enumerate(lines):
            if "function defaultKillSwitch" in line:
                func_start = i
                break
        if func_start is None:
            c4_failures.append(f"{C4_TARGET}: function defaultKillSwitch not found")
        else:
            # Check within next 20 lines for mode: "trading" and engaged: false
            window = "\n".join(lines[func_start:func_start + 20])
            if '"trading"' not in window and "'trading'" not in window:
                c4_failures.append(
                    f"{C4_TARGET}:{func_start + 1}: defaultKillSwitch does not default to mode 'trading'"
                )
            if "engaged: false" not in window:
                c4_failures.append(
                    f"{C4_TARGET}:{func_start + 1}: defaultKillSwitch does not default to engaged: false"
                )

        if not c4_failures:
            c4_pass = True

    if c4_pass:
        results.append((4, "PASS", "Kill switch default: mode='trading', engaged=false (not tripped)"))
    else:
        all_pass = False
        fail(4, "Kill switch default state", c4_failures)
        results.append((4, "FAIL", "Kill switch default state wrong"))

    # -----------------------------------------------------------------------
    # Check 5: Paper mode / order UI default OFF
    # NEXT_PUBLIC_IUF_ORDER_UI_ENABLED=false in .env.example
    # -----------------------------------------------------------------------
    C5_TARGET = REPO_ROOT / ".env.example"
    c5_pass = False
    c5_failures: list[str] = []

    if not C5_TARGET.exists():
        c5_failures.append(f"{C5_TARGET}: .env.example not found")
    else:
        content = C5_TARGET.read_text(encoding="utf-8")
        # Check for the order UI gate variable
        if "NEXT_PUBLIC_IUF_ORDER_UI_ENABLED" not in content:
            c5_failures.append(
                f"{C5_TARGET}: NEXT_PUBLIC_IUF_ORDER_UI_ENABLED not found in .env.example"
            )
        else:
            for i, line in enumerate(content.splitlines(), 1):
                if "NEXT_PUBLIC_IUF_ORDER_UI_ENABLED" in line and "=" in line:
                    val = line.split("=", 1)[1].strip().lower()
                    if val in ("false", "0", ""):
                        c5_pass = True
                    else:
                        c5_failures.append(
                            f"{C5_TARGET}:{i}: NEXT_PUBLIC_IUF_ORDER_UI_ENABLED default is '{val}' (expected false/0)"
                        )
                    break
            if "NEXT_PUBLIC_IUF_ORDER_UI_ENABLED" in content and not c5_failures:
                c5_pass = True

    if c5_pass:
        results.append((5, "PASS", "Paper/order UI default OFF (NEXT_PUBLIC_IUF_ORDER_UI_ENABLED=false)"))
    else:
        all_pass = False
        fail(5, "Paper mode default OFF", c5_failures)
        results.append((5, "FAIL", "Paper mode default not OFF"))

    # -----------------------------------------------------------------------
    # Check 6: No hardcoded secret / credential in tracked source files
    # Exclusions: .env.example, *.md, test mocks that reference var names only
    # -----------------------------------------------------------------------
    SECRET_PATTERNS = [
        # Real credential patterns: variable = actual value (20+ alphanumeric chars)
        re.compile(r'KGI_PASSWORD\s*=\s*["\']?[A-Za-z0-9!@#$%^&*]{8,}["\']?'),
        re.compile(r'KGI_PERSON_ID\s*=\s*["\']?[A-Za-z0-9]{6,}["\']?'),
        re.compile(r'API_KEY\s*=\s*["\']?[A-Za-z0-9_\-]{20,}["\']?'),
        # Hardcoded password assignments (not just env-var references)
        re.compile(r'password\s*=\s*["\'][A-Za-z0-9!@#$%^&*]{8,}["\']', re.IGNORECASE),
    ]
    # Files to skip
    SECRET_SKIP_SUFFIXES = {".md", ".txt", ".example"}
    SECRET_SKIP_NAMES = {".env.example"}
    # Directories to skip (evidence, worktrees, node_modules)
    SECRET_SKIP_DIRS = {"node_modules", ".git", "evidence", ".claude", "dist", ".next", "__pycache__"}

    c6_failures: list[str] = []

    def should_skip_dir(d: Path) -> bool:
        return d.name in SECRET_SKIP_DIRS

    def scan_for_secrets(root: Path) -> None:
        if root.is_file():
            _check_file_for_secrets(root)
            return
        for item in root.iterdir():
            if item.is_dir():
                if should_skip_dir(item):
                    continue
                scan_for_secrets(item)
            elif item.is_file():
                _check_file_for_secrets(item)

    def _check_file_for_secrets(f: Path) -> None:
        if f.suffix in SECRET_SKIP_SUFFIXES:
            return
        if f.name in SECRET_SKIP_NAMES:
            return
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return
        for pattern in SECRET_PATTERNS:
            for i, line in enumerate(text.splitlines(), 1):
                stripped = line.strip()
                # Skip comment lines
                if stripped.startswith(("//", "#", "*", "/*", "\"\"\"", "'''")):
                    continue
                # Skip test files that reference pattern names (not real values)
                if "test_" in f.name or f.name.startswith("test"):
                    if "os.environ" in line or "patch.dict" in line or "getenv" in line:
                        continue
                if pattern.search(line):
                    c6_failures.append(
                        f"{f}:{i}: potential credential — {line.strip()[:80]}"
                    )

    scan_for_secrets(REPO_ROOT / "apps")
    scan_for_secrets(REPO_ROOT / "services")
    scan_for_secrets(REPO_ROOT / "packages")
    scan_for_secrets(REPO_ROOT / "scripts")
    # Check .env files (not .env.example)
    for env_file in REPO_ROOT.glob(".env*"):
        if env_file.name == ".env.example":
            continue
        _check_file_for_secrets(env_file)

    if not c6_failures:
        results.append((6, "PASS", "No hardcoded credentials found in source files"))
    else:
        all_pass = False
        fail(6, "No secret/credential committed", c6_failures)
        results.append((6, "FAIL", "Hardcoded credential found"))

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("W6 NO-REAL-ORDER AUDIT RESULTS")
    print("=" * 60)
    for num, status, summary in results:
        mark = "[PASS]" if status == "PASS" else "[FAIL]"
        print(f"  {mark} Check {num}: {summary}")
    print("=" * 60)

    if all_pass:
        print("AUDIT PASS — 6 checks green")
        return True
    else:
        failed = [r for r in results if r[1] == "FAIL"]
        print(f"AUDIT FAIL — {len(failed)}/6 check(s) failed")
        return False


if __name__ == "__main__":
    passed = run_audit()
    sys.exit(0 if passed else 1)
