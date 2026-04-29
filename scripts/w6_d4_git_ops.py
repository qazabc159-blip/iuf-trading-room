#!/usr/bin/env python3
"""
W6 Day 4 — git ops: create branch, build, run checks, commit, push, open DRAFT PR.

Run from repo root:
    python scripts/w6_d4_git_ops.py

Requires:
  - git installed and configured
  - gh CLI installed and authenticated
  - pnpm installed
  - Python 3.11+
  - PR #17 (feat/w6-day3-paper-route) already on remote

Steps:
  1. Fetch + checkout feat/w6-day3-paper-route (PR #17 base)
  2. Create feat/w6-day4-paper-db-swap branch
  3. Build db package (needed for paperOrders/paperFills schema exports)
  4. Typecheck (pnpm -F api typecheck)
  5. Run D4 tests (7 tests)
  6. Commit + push
  7. Open DRAFT PR with base = feat/w6-day3-paper-route
"""

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parent.parent
BASE_BRANCH = "feat/w6-day3-paper-route"
NEW_BRANCH = "feat/w6-day4-paper-db-swap"
REMOTE = "origin"


def run(cmd: list[str], *, cwd: Path = REPO, check: bool = True) -> subprocess.CompletedProcess:
    print(f"\n$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=False, text=True)
    if check and result.returncode != 0:
        print(f"\n[ERROR] command failed with exit code {result.returncode}")
        sys.exit(result.returncode)
    return result


def run_capture(cmd: list[str], *, cwd: Path = REPO) -> subprocess.CompletedProcess:
    print(f"\n$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print(result.stderr)
    return result


def main():
    print("=" * 60)
    print("W6 Day 4 — DB swap skeleton git ops")
    print("=" * 60)

    # Step 1: fetch + checkout base branch
    run(["git", "fetch", REMOTE, BASE_BRANCH])
    run(["git", "checkout", f"{REMOTE}/{BASE_BRANCH}", "-B", BASE_BRANCH])

    # Step 2: create day4 branch
    r = run_capture(["git", "branch", "--list", NEW_BRANCH])
    if NEW_BRANCH in r.stdout:
        print(f"Branch {NEW_BRANCH} already exists — checking out")
        run(["git", "checkout", NEW_BRANCH])
    else:
        run(["git", "checkout", "-b", NEW_BRANCH])

    # Step 3: build db package (schema.ts now has paperOrders + paperFills)
    print("\n--- build @iuf-trading-room/db ---")
    run(["pnpm", "--filter", "@iuf-trading-room/db", "build"])

    # Step 4: typecheck api
    print("\n--- typecheck api ---")
    run(["pnpm", "--filter", "api", "typecheck"])

    # Step 5: run D4 tests
    print("\n--- D4 unit tests (7 tests) ---")
    test_file = REPO / "apps" / "api" / "src" / "domain" / "trading" / "paper-ledger-db.test.ts"
    run([
        "node", "--test",
        "--import", "tsx/esm",
        str(test_file)
    ])

    # Also run regression on earlier tests
    print("\n--- regression: D2 tests ---")
    d2_test = REPO / "apps" / "api" / "src" / "__tests__" / "paper-executor.test.ts"
    run([
        "node", "--test",
        "--import", "tsx/esm",
        str(d2_test)
    ])

    # Step 6: stage + commit
    new_files = [
        "packages/db/src/schema.ts",          # added paperOrders + paperFills drizzle tables
        "apps/api/src/domain/trading/paper-ledger-db.ts",
        "apps/api/src/domain/trading/paper-ledger-db.test.ts",
        "scripts/w6_d4_git_ops.py",
    ]
    for f in new_files:
        run(["git", "add", f])

    commit_msg = (
        "feat(w6-d4): DB-backed paper ledger skeleton + 7 unit tests (DRAFT)\n\n"
        "Files added:\n"
        "  - packages/db/src/schema.ts — paperOrders + paperFills drizzle table defs\n"
        "  - apps/api/src/domain/trading/paper-ledger-db.ts — DrizzleAdapter + 5 public fns\n"
        "  - apps/api/src/domain/trading/paper-ledger-db.test.ts — 7 unit tests (T1-T7)\n\n"
        "Architecture:\n"
        "  - LedgerAdapter interface for DI; DrizzleAdapter uses paperOrders/paperFills\n"
        "  - Tests use Map-backed adapter (no real DB needed)\n"
        "  - Export shape mirrors paper-ledger.ts for zero-friction D5 swap\n\n"
        "Boundaries held:\n"
        "  - No server.ts route wiring (D5)\n"
        "  - No paper-ledger.ts changes (fallback preserved)\n"
        "  - No new migration (0015 already exists)\n"
        "  - No KGI SDK / broker import\n"
        "  - No kill switch / ExecutionMode default changes\n\n"
        "Stacked on: feat/w6-day3-paper-route (PR #17)"
    )
    run(["git", "commit", "-m", commit_msg])

    # Step 7: push
    run(["git", "push", "-u", REMOTE, NEW_BRANCH])

    # Step 8: open DRAFT PR
    pr_body = """## D4 — DB-backed Paper Ledger Skeleton

**Stacked on PR #17 (`feat/w6-day3-paper-route`). Do not merge to main — merge to `feat/w6-day3-paper-route`.**

---

### Scope

Day 4 adds the DB-backed persistence layer for the paper ledger. Day 5 will wire this into `server.ts`.

### Files Added / Modified

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Added `paperOrders` + `paperFills` drizzle table definitions (mirrors migration 0015) |
| `apps/api/src/domain/trading/paper-ledger-db.ts` | New: DrizzleAdapter + 5 public functions matching paper-ledger.ts shape |
| `apps/api/src/domain/trading/paper-ledger-db.test.ts` | New: 7 unit tests (T1–T7) |

### Architecture

```
paper-ledger-db.ts exports:
  upsertOrder / getOrder / listOrders / recordFill / deleteOrder
  (identical shape to paper-ledger.ts — D5 swap is a 1-line import change)

LedgerAdapter interface (internal):
  saveOrder / findOrder / listOrders / saveFill / removeOrder

DrizzleAdapter (prod):
  wraps DatabaseClient from @iuf-trading-room/db
  uses INSERT...ON CONFLICT DO UPDATE for idempotent upserts
  uses CASCADE via FK (paper_fills.order_id → paper_orders.id)

MapAdapter (test):
  Map-backed implementation of same LedgerAdapter interface
  no native DB binary required
```

### Tests — 7 tests (T1–T7)

```
T1: upsertOrder + getOrder round-trip
T2: listOrders userId isolation (cross-user cannot see other user's orders)
T3: listOrders status filter (PENDING / FILLED / all)
T4: recordFill once → idempotent second call is no-op (only 1 fill row)
T5: deleteOrder removes row; getOrder returns undefined after
T6: upsertOrder with same idempotencyKey updates status (ON CONFLICT DO UPDATE)
T7: recordFill returns false for unknown orderId
```

### No new migration

Migration 0015 was created in D1. schema.ts additions are the matching Drizzle TS bindings only.

### D5 next step

- `server.ts` paper route block: swap `import ... from paper-ledger.js` → `paper-ledger-db.js`
- Bruce: run T1–T7 against real Postgres (PERSISTENCE_MODE=database) as integration gate

### Hard lines held

- No KGI SDK / broker import
- No `/order/create` changes
- No `paper-ledger.ts` changes (in-memory fallback preserved)
- No `server.ts` route wiring (D5)
- No new migration file
- No kill switch / ExecutionMode defaults changed
- DRAFT only — no production deploy

---
*Stacked DRAFT — base = `feat/w6-day3-paper-route` (PR #17)*
"""

    run([
        "gh", "pr", "create",
        "--draft",
        "--base", BASE_BRANCH,
        "--title", "feat(w6-d4): DB-backed paper ledger skeleton + 7 unit tests (DRAFT)",
        "--body", pr_body
    ])

    print("\n" + "=" * 60)
    print("W6 Day 4 git ops complete.")
    print("D5 next: wire paper-ledger-db into server.ts paper route block.")
    print("=" * 60)


if __name__ == "__main__":
    main()
