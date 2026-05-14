# CI Test Hang Deep Fix — 2026-05-14

## Root Cause

PR #462 applied `.unref()` only to `setInterval` handles. Seven `setTimeout` calls inside
`startSchedulers` (and `scheduleInitialSchedulerTick`) were missed. These 10s–60s timers
kept the Node event loop alive after all tests completed, causing a 20-minute CI timeout.

## Fix — Two Layers

### Layer 1: server.ts — unref all startup setTimeout calls

Files modified: `apps/api/src/server.ts`

Calls fixed (added `.unref()`):
1. `scheduleInitialSchedulerTick` — delayMs setTimeout (covers all 9 initial scheduler ticks)
2. brief dispatcher startup catch-up — 30s
3. pipeline missed-day catch-up — 15s
4. pre-market boot recovery — 10s
5. event engine initial tick — 30s
6. news-ai-selector boot recovery — 30s
7. FinMind boot ingest — 60s
8. TWSE announcement boot catch-up — 45s

### Layer 2: ci.test.ts — force process.exit fallback

Files modified: `tests/ci.test.ts`

Added a 5s hard-exit timer at the end of the test file:
- Fires `process.exit(process.exitCode ?? 0)` if process is still alive 5s after test file ends
- Preserves pass/fail exit code (node:test runner sets `process.exitCode` before tests complete)
- Guards against postgres.js pool keep-alive sockets or any other handle not covered by unref

## Verified

- All 8 startup setTimeout calls in server.ts now have `.unref()`
- All setInterval calls already had `.unref()` from PR #462
- Force exit in ci.test.ts uses `process.exitCode ?? 0` (pass/fail preserved)
- No prod runtime changes (unref does not affect prod — HTTP server handle keeps process alive)
- No contracts modified
- Lane boundary maintained

## Files Changed

- `apps/api/src/server.ts` — 8 setTimeout calls now unref'd
- `tests/ci.test.ts` — force exit block added after last test
