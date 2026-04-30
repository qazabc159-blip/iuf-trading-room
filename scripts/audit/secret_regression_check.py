#!/usr/bin/env python3
"""
secret_regression_check.py — Anti-regression guard for KGI credential leakage.

Greps the entire repo for the OLD KGI password literal and known PII patterns.
Exits 1 if any match found in tracked files (excluding this script itself and
the secret_inventory.md governance doc).

Usage:
    python scripts/audit/secret_regression_check.py [--repo-root PATH]

Wire into CI (.github/workflows/ci.yml):
    - name: Secret regression check
      run: python scripts/audit/secret_regression_check.py

Exit codes:
    0 — clean (no forbidden patterns found)
    1 — match found (potential credential leak — block merge)
"""

import re
import sys
import os
import argparse
from pathlib import Path

# ---------------------------------------------------------------------------
# Patterns to search (literal strings + regex)
# ---------------------------------------------------------------------------

# OLD KGI password — rotated 2026-04-30 (A1). Must never appear again.
LITERAL_FORBIDDEN = [
    "qaz050208",           # OLD KGI password (rotated 2026-04-30)
]

# Regex patterns for live KGI PII values
REGEX_FORBIDDEN = [
    # Real person_id: capital letter + 9 digits (e.g. F131331910)
    # Only flag if it looks like a value assignment, not a regex pattern itself
    r'(?<![A-Z0-9_])F131331910(?![0-9])',
    # Real account number
    r'(?<![0-9])0308732(?![0-9])',
]

# ---------------------------------------------------------------------------
# Exclusion rules
# ---------------------------------------------------------------------------

# Files to always skip (governance docs, this script)
SKIP_FILES = {
    "scripts/audit/secret_regression_check.py",   # this file
    "secret_inventory.md",                          # governance reference doc
    "evidence/path_b_w2a_20260426/redaction_policy_v1.md",  # meta-doc
    # Audit trail / reconciliation docs that legitimately enumerate the
    # identifiers as part of "what was redacted" tables. These are meta-
    # references in governance documentation, not live PII leaks.
    "evidence/w7_paper_sprint/l5_secret_inventory_reconciliation_2026-04-30.md",
    "evidence/w7_paper_sprint/overnight_progress_log_2026-04-29_to_30.md",
    "evidence/w7_paper_sprint/overnight_closeout_FINAL_2026-04-30.md",
    "evidence/w7_paper_sprint/eod_summary_2026-04-30_morning.md",
    ".claude/agent-memory/verifier-release-bruce/l5_housekeeping_audit_learnings.md",
    # Audit script transcripts that enumerate the identifiers in their
    # "command sequence used" appendix as `Grep '0308732' in ...`
    "evidence/path_b_w3_read_only_2026-04-27/bruce_w4_overnight_drift_audit.md",
}

# Directory prefixes to skip (worktrees, node_modules, .git)
SKIP_DIR_PREFIXES = [
    ".git",
    "node_modules",
    ".next",
    "dist",
    ".turbo",
    ".claude/worktrees",
    "coverage",
]

# File extensions to skip (binaries, compiled, zips)
SKIP_EXTENSIONS = {
    ".zip", ".png", ".jpg", ".jpeg", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot",
    ".pyc", ".pyo", ".so", ".dll", ".exe",
    ".tsbuildinfo",
}


def should_skip(rel_path: str) -> bool:
    """Return True if the file should be excluded from scanning."""
    norm = rel_path.replace("\\", "/")

    if norm in SKIP_FILES:
        return True

    for prefix in SKIP_DIR_PREFIXES:
        if norm.startswith(prefix + "/") or norm == prefix:
            return True

    ext = Path(rel_path).suffix.lower()
    if ext in SKIP_EXTENSIONS:
        return True

    return False


def scan_file(path: Path, rel: str) -> list[tuple[int, str, str]]:
    """
    Scan a single file for forbidden patterns.
    Returns list of (line_number, pattern, line_content).
    """
    hits = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return hits

    for lineno, line in enumerate(text.splitlines(), 1):
        for literal in LITERAL_FORBIDDEN:
            if literal in line:
                hits.append((lineno, f"LITERAL:{literal}", line.strip()))

        for pattern in REGEX_FORBIDDEN:
            if re.search(pattern, line):
                hits.append((lineno, f"REGEX:{pattern}", line.strip()))

    return hits


def main() -> int:
    parser = argparse.ArgumentParser(description="Secret regression check")
    parser.add_argument(
        "--repo-root",
        default=None,
        help="Repo root directory (default: auto-detect from this script's location)",
    )
    args = parser.parse_args()

    if args.repo_root:
        root = Path(args.repo_root).resolve()
    else:
        # This script lives at scripts/audit/secret_regression_check.py
        root = Path(__file__).resolve().parent.parent.parent

    if not root.is_dir():
        print(f"ERROR: repo root not found: {root}", file=sys.stderr)
        return 1

    print(f"Scanning repo: {root}")
    print(f"Forbidden literals: {LITERAL_FORBIDDEN}")
    print(f"Forbidden regex patterns: {len(REGEX_FORBIDDEN)} patterns")
    print()

    total_files = 0
    total_hits = 0
    findings: list[tuple[str, int, str, str]] = []

    for filepath in root.rglob("*"):
        if not filepath.is_file():
            continue
        rel = str(filepath.relative_to(root))
        if should_skip(rel):
            continue

        total_files += 1
        file_hits = scan_file(filepath, rel)
        if file_hits:
            for lineno, pattern, content in file_hits:
                findings.append((rel, lineno, pattern, content))
                total_hits += 1

    print(f"Scanned {total_files} files.")

    if findings:
        print(f"\nFAIL — {total_hits} forbidden pattern(s) found:\n")
        for rel, lineno, pattern, content in findings:
            print(f"  {rel}:{lineno}")
            print(f"    Pattern : {pattern}")
            print(f"    Content : {content[:120]}")
            print()
        print("ACTION REQUIRED: Redact these values before merging.")
        print("Reference: evidence/w7_paper_sprint/l5_secret_inventory_reconciliation_2026-04-30.md")
        return 1
    else:
        print("PASS — 0 forbidden patterns found.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
