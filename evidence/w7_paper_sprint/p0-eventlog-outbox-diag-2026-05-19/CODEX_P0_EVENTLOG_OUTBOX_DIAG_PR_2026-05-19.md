# P0 EventLog Outbox Diagnostics Evidence - 2026-05-19

## Scope

Frontend-only PR-F EventLog truth-state rescue.

## Production finding before fix

- Route: `https://app.eycvector.com/admin/events`
- Page opened with owner session and HTTP 200.
- Backend diagnostic endpoint returned:

```json
{"data":{"pendingCount":-1,"fatalCount":-1,"isPollerRunning":true}}
```

- Product issue: the page rendered `Outbox 待發 -1`, which is raw/incoherent diagnostic data.

## Fix

- Add `normalizeOutboxDiag` in `apps/web/lib/eventlog-outbox.ts`.
- Negative or non-finite counts become a formal degraded diagnostic state.
- The UI displays `診斷異常` and a source/owner/next-action state.
- The UI does not fake invalid counts as `0`.

## Local verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- eventlog-outbox.test.ts`
  - Result: 14 test files / 181 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Production verification

Pending PR merge and web deploy.
