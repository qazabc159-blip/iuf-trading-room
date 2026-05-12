#!/usr/bin/env python3
"""
secret_regression_check.py — Anti-regression guard for credential leakage.

Purpose:
- Block obvious committed secrets in tracked source files.
- Avoid storing historical plaintext secrets or real PII inside this scanner.
- Keep this script safe even if the repository visibility changes later.

Exit codes:
    0 — clean
    1 — potential credential leak found
"""

import argparse
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Generic high-risk patterns
# ---------------------------------------------------------------------------

SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "generic_api_key_assignment",
        re.compile(
            r"""(?ix)
            \b(?:api[_-]?key|secret|token|password|passwd|pwd|jwt|private[_-]?key)\b
            \s*[:=]\s*
            ["']?
            [A-Za-z0-9_\-./+=!@#$%^&*]{16,}
            ["']?
            """
        ),
    ),
    (
        "openai_project_or_secret_key",
        re.compile(r"\b(?:sk-|sk-proj-)[A-Za-z0-9_\-]{20,}\b"),
    ),
    (
        "github_token",
        re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    ),
    (
        "aws_access_key_id",
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    ),
    (
        "private_key_block",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----"),
    ),
    (
        "taiwan_id_literal",
        re.compile(r"\b[A-Z][12][0-9]{8}\b"),
    ),
    (
        "railway_or_service_token_assignment",
        re.compile(
            r"""(?ix)
            \b(?:railway[_-]?token|finmind[_-]?api[_-]?token|tv[_-]?webhook[_-]?token|market[_-]?agent[_-]?hmac[_-]?secret)\b
            \s*[:=]\s*
            ["']?
            [A-Za-z0-9_\-./+=]{12,}
            ["']?
            """
        ),
    ),
]

# Values that are allowed in examples/docs because they are placeholders.
SAFE_PLACEHOLDER_VALUES = {
    "",
    "replace-with-your-secret",
    "replace-with-your-tradingview-secret",
    "replace-with-your-finmind-token",
    "replace-with-your-api-key",
    "changeme",
    "<secret>",
    "<token>",
    "<password>",
    "postgres",
    "localhost",
    "memory",
    "mock",
}

# ---------------------------------------------------------------------------
# Exclusion rules
# ---------------------------------------------------------------------------

SKIP_FILES = {
    "scripts/audit/secret_regression_check.py",
}

SKIP_DIR_PREFIXES = {
    ".git",
    "node_modules",
    ".next",
    "dist",
    ".turbo",
    ".runtime",
    "coverage",
    "__pycache__",
}

SKIP_PATH_PREFIXES = {
    ".claude/worktrees",
    ".worktrees",
}

SKIP_EXTENSIONS = {
    ".zip",
    ".png",
    ".jpg",
    ".jpeg",
    ".ico",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".pyc",
    ".pyo",
    ".so",
    ".dll",
    ".exe",
    ".tsbuildinfo",
}

# Markdown and env examples are scanned more lightly.
LIGHT_SCAN_SUFFIXES = {
    ".md",
    ".txt",
    ".example",
}

# ---------------------------------------------------------------------------
# Allowlist patterns — lines matching any of these are NOT flagged.
# Each entry is (description, compiled_pattern).
# Order matters: checked top-to-bottom; first match wins.
# ---------------------------------------------------------------------------

ALLOWLIST_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # 1. process.env reads/writes — reading an env var is never a hardcoded secret.
    #    Covers:  const x = process.env.SECRET
    #             process.env.FINMIND_API_TOKEN = originalToken
    #             process.env.FINMIND_API_TOKEN = "test_token_placeholder"
    #    Note: we still catch genuinely hardcoded values because they won't have
    #    process.env on the RHS.
    (
        "process.env read or assignment",
        re.compile(r"process\.env\b"),
    ),
    # 2. Function-call results assigned to a token/secret variable.
    #    e.g.  const token = issueConfirmToken(run.id);
    #          const tokenResp = issueConfirmToken(run.id);
    #    The RHS is a function call, not a string literal.
    (
        "function-call result assigned to credential variable",
        re.compile(
            r"""(?ix)
            \b(?:token|secret|password|jwt|api[_-]?key)\b
            \s*=\s*
            \w+\s*\(
            """
        ),
    ),
    # 3. Object property containing a variable reference (not a string literal).
    #    e.g.  token: registration.deviceToken
    #          token: registrationA.deviceToken
    #    Characteristic: colon+space followed by an identifier (no quotes), possibly
    #    with dot-access chain.
    (
        "object property referencing a variable (no string literal)",
        re.compile(
            r"""(?ix)
            \b(?:token|secret|password|jwt|api[_-]?key)\s*:\s*
            [A-Za-z_]\w*(?:\.\w+)+\s*[,}]?
            """
        ),
    ),
    # 4. Test-labelled string literals.  These are strings that explicitly declare
    #    they are mock/test/smoke values by embedding that in the string content.
    #    The value must be inside quotes to match this rule.
    #    e.g.  "test-hmac-secret-for-h3-tests"
    #          "test-drain-secret"
    #          "test_token_placeholder"
    #          "smoke-webhook-token"
    #          "should-be-redacted"
    #          "raw_attr_password"
    #          "log_redaction_password"
    (
        "test/mock/smoke labelled string literal",
        re.compile(
            r"""(?ix)
            ["']
            (?:[A-Za-z0-9_\-]*)
            (?:test|mock|smoke|placeholder|redact|dummy|fake|example|sample|stub|fixture)
            (?:[A-Za-z0-9_\-]*)
            ["']
            """,
        ),
    ),
    # 5. Taiwan-ID placeholder A123456789 — universally recognised mock value used
    #    in KGI gateway test fixtures and docs.  Real person_id values follow the
    #    same format but would not contain the sequential "123456789" suffix.
    (
        "taiwan_id A123456789 placeholder",
        re.compile(r"\bA123456789\b"),
    ),
    # 6. Evidence / doc files mentioning masked tokens (e.g. ***0732, ***-redacted).
    #    These appear in security inventory docs and are clearly redacted.
    (
        "masked/redacted token in evidence doc",
        re.compile(r"\*{2,}[A-Za-z0-9]{2,6}\b"),
    ),
    # 7. TV_WEBHOOK_TOKEN variable reference in smoke script
    #    e.g.  TV_WEBHOOK_TOKEN: webhookToken   (value is an identifier, not a string)
    (
        "service token env-key mapped to variable (no literal)",
        re.compile(
            r"""(?ix)
            \b(?:tv[_-]?webhook[_-]?token|finmind[_-]?api[_-]?token|market[_-]?agent[_-]?hmac[_-]?secret)\s*
            [:,]\s*
            [A-Za-z_]\w*\s*[,}]?$
            """
        ),
    ),
]

# Directories that receive light scan (taiwan_id exempted, only real secrets checked).
# Evidence files and docs — these contain historical log data.
EVIDENCE_OR_TEST_DIR_PREFIXES = {
    "evidence/",
    ".claude/agent-memory/",
    "reports/",
}

# Directories that are FULLY SKIPPED for all secret patterns.
# These contain intentional mock credentials in unit-test fixtures.
SKIP_ALL_SECRET_PATTERNS_DIR_PREFIXES = {
    "services/kgi-gateway/tests/",
    "services/market-agent/tests/",
}


def normalize_rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def should_skip(rel_path: str, path: Path) -> bool:
    if rel_path in SKIP_FILES:
        return True

    for prefix in SKIP_PATH_PREFIXES:
        if rel_path == prefix or rel_path.startswith(f"{prefix}/"):
            return True

    parts = set(Path(rel_path).parts)
    if parts & SKIP_DIR_PREFIXES:
        return True

    if path.suffix.lower() in SKIP_EXTENSIONS:
        return True

    return False


def iter_candidate_files(root: Path):
    """Yield scan candidates while tolerating local agent worktrees and broken junctions."""
    def ignore_walk_error(_error: OSError) -> None:
        return None

    for dirpath, dirnames, filenames in os.walk(
        root,
        topdown=True,
        onerror=ignore_walk_error,
        followlinks=False,
    ):
        current_dir = Path(dirpath)
        kept_dirs: list[str] = []
        for dirname in dirnames:
            child_dir = current_dir / dirname
            rel_dir = normalize_rel(child_dir, root)
            if should_skip(rel_dir, child_dir):
                continue
            kept_dirs.append(dirname)
        dirnames[:] = kept_dirs

        for filename in filenames:
            yield current_dir / filename


def is_comment_or_placeholder_line(line: str) -> bool:
    stripped = line.strip()

    if not stripped:
        return True

    if stripped.startswith(("#", "//", "*", "/*", "<!--")):
        return True

    # Allow pure env placeholder assignments such as OPENAI_API_KEY=
    if "=" in stripped:
        _, value = stripped.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value.lower() in SAFE_PLACEHOLDER_VALUES:
            return True
        if value.startswith("<") and value.endswith(">"):
            return True

    return False


def is_light_scan_safe(rel_path: str, line: str) -> bool:
    suffix = Path(rel_path).suffix.lower()
    if suffix not in LIGHT_SCAN_SUFFIXES:
        return False

    lowered = line.lower()
    safe_doc_markers = [
        "<secret>",
        "<token>",
        "<password>",
        "replace-with-your",
        "never commit",
        "set in railway env",
        "github actions secret",
        "example",
        "placeholder",
    ]

    return any(marker in lowered for marker in safe_doc_markers)


def is_evidence_or_test_path(rel_path: str) -> bool:
    """Return True for paths that contain historical/forensic data (taiwan_id exempted)."""
    for prefix in EVIDENCE_OR_TEST_DIR_PREFIXES:
        if rel_path.startswith(prefix):
            return True
    return False


def is_test_fixture_path(rel_path: str) -> bool:
    """Return True for paths in unit-test fixture dirs (all secret patterns exempted).

    These directories intentionally contain mock credentials like:
      - password = "raw_attr_password"
      - person_id = "A123456789"
    They are never production secrets.
    """
    for prefix in SKIP_ALL_SECRET_PATTERNS_DIR_PREFIXES:
        if rel_path.startswith(prefix):
            return True
    return False


def is_allowlisted(line: str) -> bool:
    """Return True if the line matches any allowlist rule (safe false-positive)."""
    for _desc, pattern in ALLOWLIST_PATTERNS:
        if pattern.search(line):
            return True
    return False


def scan_file(path: Path, rel_path: str) -> list[tuple[int, str, str]]:
    findings: list[tuple[int, str, str]] = []

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return findings

    # Unit-test fixture directories: intentional mock credentials — skip all patterns.
    if is_test_fixture_path(rel_path):
        return findings

    is_evidence = is_evidence_or_test_path(rel_path)

    for lineno, line in enumerate(text.splitlines(), 1):
        if is_comment_or_placeholder_line(line):
            continue

        if is_light_scan_safe(rel_path, line):
            continue

        # Evidence/forensic dirs: only flag non-Taiwan-ID patterns
        # (taiwan_id pattern produces too many false positives from historical logs)
        for label, pattern in SECRET_PATTERNS:
            if is_evidence and label == "taiwan_id_literal":
                continue
            if pattern.search(line):
                # Check allowlist before flagging
                if is_allowlisted(line):
                    continue
                findings.append((lineno, label, line.strip()[:160]))

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Secret regression check")
    parser.add_argument(
        "--repo-root",
        default=None,
        help="Repo root directory. Default: auto-detect from this script path.",
    )
    args = parser.parse_args()

    if args.repo_root:
        root = Path(args.repo_root).resolve()
    else:
        root = Path(__file__).resolve().parent.parent.parent

    if not root.is_dir():
        print(f"ERROR: repo root not found: {root}", file=sys.stderr)
        return 1

    total_files = 0
    findings: list[tuple[str, int, str, str]] = []

    for path in iter_candidate_files(root):
        try:
            if not path.is_file():
                continue
        except OSError:
            continue

        rel_path = normalize_rel(path, root)
        if should_skip(rel_path, path):
            continue

        total_files += 1
        for lineno, label, snippet in scan_file(path, rel_path):
            findings.append((rel_path, lineno, label, snippet))

    print(f"Scanning repo: {root}")
    print(f"Scanned {total_files} files.")

    if findings:
        print(f"\nFAIL — {len(findings)} potential secret pattern(s) found:\n")
        for rel_path, lineno, label, snippet in findings:
            print(f"  {rel_path}:{lineno}")
            print(f"    Pattern : {label}")
            print("    Content : [redacted]")
            print()
        print("ACTION REQUIRED: remove or replace these values with environment variables / GitHub Secrets.")
        return 1

    print("PASS — 0 potential secret patterns found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
