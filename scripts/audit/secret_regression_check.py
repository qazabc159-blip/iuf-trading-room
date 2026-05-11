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
    "coverage",
    "__pycache__",
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


def normalize_rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def should_skip(rel_path: str, path: Path) -> bool:
    if rel_path in SKIP_FILES:
        return True

    parts = set(Path(rel_path).parts)
    if parts & SKIP_DIR_PREFIXES:
        return True

    if path.suffix.lower() in SKIP_EXTENSIONS:
        return True

    return False


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


def scan_file(path: Path, rel_path: str) -> list[tuple[int, str, str]]:
    findings: list[tuple[int, str, str]] = []

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return findings

    for lineno, line in enumerate(text.splitlines(), 1):
        if is_comment_or_placeholder_line(line):
            continue

        if is_light_scan_safe(rel_path, line):
            continue

        for label, pattern in SECRET_PATTERNS:
            if pattern.search(line):
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

    for path in root.rglob("*"):
        if not path.is_file():
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
            print(f"    Content : {snippet}")
            print()
        print("ACTION REQUIRED: remove or replace these values with environment variables / GitHub Secrets.")
        return 1

    print("PASS — 0 potential secret patterns found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
