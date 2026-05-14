# CI Esbuild Orphan Fix — Jason — 2026-05-14

## Root Cause (Confirmed by CI log)

PR #464 env-gate scheduler PASSED: `[schedulers] CI/test mode detected — skipping all scheduler boot`
Schedulers did NOT boot.

CI still hung 17min. Cancel log showed:
```
Terminate orphan process: pid (2814) (esbuild)
Terminate orphan process: pid (2820) (esbuild)
Terminate orphan process: pid (2829) (esbuild)
```

Root cause: `tsx` loader spawns esbuild service workers at test startup; `node:test` runner does
not kill child processes — it relies on natural event loop drain. esbuild workers keep the process
alive indefinitely.

## Fix Applied

File: `tests/ci.test.ts`
- Added `after` to `node:test` import
- Appended `after()` hook at end-of-file:
  - 500ms flush window (reporter writes)
  - `process.exit(process.exitCode ?? 0)` — preserves fail signal

## What Was NOT Touched

- `apps/api/src/server.ts` — untouched
- `apps/api/src/strategy-engine.ts` — untouched
- Any scheduler logic — untouched
- Production behaviour: zero impact

## Commit & PR

- Branch: `fix/test-force-exit-esbuild-orphan-2026-05-14`
- Commit: `64b9001`
- PR: #465 — https://github.com/qazabc159-blip/iuf-trading-room/pull/465
- Files changed: 1 (`tests/ci.test.ts`, +8 -1)

## Status

Awaiting CI green. Auto-squash merge on green per team convention.
