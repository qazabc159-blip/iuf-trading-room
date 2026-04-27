#!/usr/bin/env python3
"""Script to create B1 DRAFT PR via gh CLI."""
import subprocess
import sys

title = "W3 B1: quote hardening H-6 plus H-9 DRAFT"
body = """W3 Lane B1 - Quote Hardening DRAFT PR

H-6 structured logging + H-9 ring buffer eviction warning.

Changes:
- apps/api/src/lib/logger.ts (NEW): structured JSON logger with redaction
- apps/api/src/lib/ring-buffer.ts (NEW): buffer utilisation check
- apps/api/src/broker/kgi-quote-client.ts: withLatency structured logging on all 5 methods
- apps/api/src/__tests__/quote-hardening.test.ts (NEW): 15 TS unit tests
- services/kgi-gateway/tests/test_logging_redaction.py (NEW): 5 Python redaction tests

Test results: TS 15/15 pass, Python 26/26 pass, typecheck EXIT 0

Hard lines held: 0 order touch / 0 contracts mutation / 0 deploy / 0 merge

DRAFT - NOT FOR MERGE
Sprint: W3 Read-Only Expansion Sprint | Lane: B1
"""

result = subprocess.run(
    [
        "gh", "pr", "create",
        "--title", title,
        "--body", body,
        "--draft",
        "--base", "main",
        "--head", "feat/w3-quote-hardening",
    ],
    capture_output=True,
    text=True,
)
print("stdout:", result.stdout)
print("stderr:", result.stderr)
print("exit code:", result.returncode)
