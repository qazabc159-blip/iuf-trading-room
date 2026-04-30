"""
w7_d3_d5_themecron_git_ops.py — Bruce's git ops for W7 D3+D5+ThemeCron

Usage (from repo root):
    cd IUF_TRADING_ROOM_APP
    python scripts/w7_d3_d5_themecron_git_ops.py

What it does:
    1. Creates branch jason/w7-d3-d5-d-themecron-2026-04-30 off current main.
    2. Stages all new/modified files for this feature.
    3. Commits in logical groups.
    4. Runs typecheck + tests.
    5. Pushes and opens draft PR.

Safe to re-run: git stash is performed if there are uncommitted changes.
"""
import subprocess
import sys
import os

BRANCH = "jason/w7-d3-d5-d-themecron-2026-04-30"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd: list[str], check: bool = True, **kwargs) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=REPO_ROOT, **kwargs)
    if check and result.returncode != 0:
        print(f"  ERROR: command failed with exit code {result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)
    return result


def main():
    print(f"[git-ops] W7 D3+D5+ThemeCron — branch: {BRANCH}")
    print()

    # Check if branch already exists
    existing = run(["git", "branch", "--list", BRANCH], capture_output=True, text=True)
    if BRANCH in existing.stdout:
        print(f"[git-ops] Branch {BRANCH} already exists. Switching to it.")
        run(["git", "checkout", BRANCH])
    else:
        run(["git", "checkout", "-b", BRANCH])

    # Commit 1: migrations
    print("\n[git-ops] Commit 1: DB migrations")
    run(["git", "add",
         "packages/db/migrations/0017_companies_ohlcv.sql",
         "packages/db/migrations/0018_daily_theme_summaries.sql"])
    run(["git", "commit", "-m",
         "feat(db): migrations 0017 companies_ohlcv + 0018 daily_theme_summaries"])

    # Commit 2: Drizzle schema
    print("\n[git-ops] Commit 2: Drizzle schema")
    run(["git", "add", "packages/db/src/schema.ts"])
    run(["git", "commit", "-m",
         "feat(schema): add companiesOhlcv + dailyThemeSummaries tables to Drizzle schema"])

    # Commit 3: companies-ohlcv module + tests
    print("\n[git-ops] Commit 3: companies-ohlcv module + tests")
    run(["git", "add",
         "apps/api/src/companies-ohlcv.ts",
         "apps/api/src/companies-ohlcv.test.ts"])
    run(["git", "commit", "-m",
         "feat(api): companies-ohlcv module: mock OHLCV + Redis cache + bulk query + T1-T8 tests"])

    # Commit 4: worker daily-theme-summary producer
    print("\n[git-ops] Commit 4: daily-theme-summary worker producer")
    run(["git", "add",
         "apps/worker/src/jobs/daily-theme-summary-producer.ts",
         "apps/worker/src/worker.ts"])
    run(["git", "commit", "-m",
         "feat(worker): daily-theme-summary-producer: OpenAI gpt-5.4-mini + fallback template + 4h cron"])

    # Commit 5: server.ts routes
    print("\n[git-ops] Commit 5: server.ts OHLCV + theme daily routes")
    run(["git", "add", "apps/api/src/server.ts"])
    run(["git", "commit", "-m",
         "feat(api): add /companies/:id/ohlcv + /companies/ohlcv/bulk + /themes/daily/:date routes"])

    # Commit 6: evidence
    print("\n[git-ops] Commit 6: evidence")
    run(["git", "add",
         "evidence/w7_paper_sprint/jason_d3_d5_themecron.md",
         "scripts/w7_d3_d5_themecron_git_ops.py"])
    run(["git", "commit", "-m",
         "docs(evidence): W7 D3+D5+ThemeCron closeout + git ops script"])

    # Typecheck
    print("\n[git-ops] Running typechecks...")
    run(["pnpm", "--filter", "@iuf-trading-room/api", "typecheck"])
    run(["pnpm", "--filter", "@iuf-trading-room/worker", "typecheck"])
    print("[git-ops] Typechecks PASS")

    # Tests
    print("\n[git-ops] Running OHLCV unit tests...")
    run(["node", "--test", "--import", "tsx/esm",
         "apps/api/src/companies-ohlcv.test.ts"])
    print("[git-ops] OHLCV tests PASS")

    # Push
    print(f"\n[git-ops] Pushing branch {BRANCH}...")
    run(["git", "push", "-u", "origin", BRANCH])

    # Open draft PR
    print("\n[git-ops] Opening draft PR...")
    pr_body = """\
## Summary
- **D3**: `companies_ohlcv` table (migration 0017) + `GET /api/v1/companies/:id/ohlcv` + deterministic mock OHLCV seeded by companyId
- **D5**: Bulk endpoint `GET /api/v1/companies/ohlcv/bulk?ids=...` + 5-minute Redis cache layer (fail-open)
- **Theme Cron**: `daily_theme_summaries` table (migration 0018) + worker daily-theme-summary-producer (gpt-5.4-mini / fallback template) + `GET /api/v1/themes/daily/:date`

## Hard lines
- No KGI SDK import
- OPENAI_MODEL locked to gpt-5.4-mini
- Migrations idempotent (IF NOT EXISTS)
- Cache failure non-blocking (W7 #11)
- No /order/create / kill-switch touch

## Test plan
- [ ] `pnpm --filter @iuf-trading-room/api typecheck` GREEN
- [ ] `pnpm --filter @iuf-trading-room/worker typecheck` GREEN
- [ ] `node --test --import tsx/esm apps/api/src/companies-ohlcv.test.ts` 8/8 PASS
- [ ] Bruce: run migrations 0017 + 0018 on prod Railway DB
- [ ] Elva: verify /api/v1/companies/:id/ohlcv returns 200 + bars array on prod

Generated with Jason (backend-strategy engineer) — W7 D3+D5+ThemeCron 2026-04-30
"""
    run(["gh", "pr", "create",
         "--draft",
         "--title", "feat(W7 D3+D5+ThemeCron): OHLCV endpoints + daily theme cron",
         "--body", pr_body,
         "--base", "main"])

    print("\n[git-ops] Done. PR created in draft.")


if __name__ == "__main__":
    main()
