# CI Scheduler Disable — Evidence
**Date**: 2026-05-14  
**PR branch**: fix/test-mode-disable-schedulers-2026-05-14  
**Owner**: Jason (backend-strategy lane)

## Root Cause

PR #462 (.unref()) and PR #463 (force process.exit) were defense-in-depth but not the root fix.
楊董明示: CI/test mode 下直接禁止所有 schedulers 自動 boot，不要只靠 .unref()。

## Fix Applied

### 1. `apps/api/src/server.ts` — env-gate in `startSchedulers()`

```ts
if (
  process.env.NODE_ENV === "test" ||
  process.env.CI === "true" ||
  process.env.SKIP_SCHEDULERS === "1"
) {
  console.log("[schedulers] CI/test mode detected — skipping all scheduler boot");
  return;
}
```

All schedulers covered by single gate at function entry:
- [pipeline-scheduler] boot_recovery / pre_market / close_watch / close_brief
- [fundamentals-scheduler] monthly revenue / financials
- [daily-brief-dispatcher] 09:00 cron + startup catch-up
- [twse-ann-ingest] boot catch-up + trading hours
- [finmind-boot-ingest] boot
- [kgi-sim-daily-smoke] 08:00-08:30 window

### 2. `tests/setup-test-env.mjs` — new preload sets NODE_ENV=test

```js
process.env.NODE_ENV = "test";
```

Loaded via `--import` before tsx, before any module is evaluated.

### 3. `package.json` — test script updated

Before: `node --import tsx --test ...`  
After:  `node --import ./tests/setup-test-env.mjs --import tsx --test ...`

## Coverage

| Scenario | Gate trigger | Result |
|---|---|---|
| GHA CI | `CI=true` (auto-set by GitHub Actions) | schedulers skip |
| Local `pnpm test` | `NODE_ENV=test` (set by setup-test-env.mjs preload) | schedulers skip |
| Manual `SKIP_SCHEDULERS=1 pnpm test` | `SKIP_SCHEDULERS=1` | schedulers skip |
| Railway prod | none of the above set | schedulers run normally |

## Build Result

`pnpm build:api` — 5/5 tasks successful, 0 TypeScript errors.

## Prod Safety

- NODE_ENV is not set to "test" in Railway prod environment
- CI is not set in Railway prod environment
- SKIP_SCHEDULERS is not set in Railway prod environment
- Prod behaviour: completely unchanged
- .unref() on all setInterval/setTimeout retained as defense-in-depth (PR #462 content)
