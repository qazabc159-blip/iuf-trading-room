# Trading Room Stale Refresh Guard - 2026-05-31

Scope: Final v031 paper trading room quick-switch stability.

## Issue

Production verification after PR #860 still showed a race:

- User clicked `1514`.
- K-line iframe briefly changed to `1514`.
- A late stale refresh for the previous selected symbol `2330` changed the iframe back.
- A later refresh changed it to `1514` again.

Observed mutation sequence before this fix:

```text
1514 -> 2330 -> 1514
```

This matched Yang's report that the K-line chart kept jumping every few seconds.

## Fix

`refreshClientLive()` now drops stale paper trading room payloads when `next.selected.symbol` does not match the current user-selected `currentPaperSymbol`.

The dropped payload is recorded in `window.__IUF_FINAL_V031_STALE_REFRESH_DROPPED__` for browser diagnostics.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local browser check on `http://127.0.0.1:3002/api/ui-final-v031/paper-trading-room?symbol=2330`

Local browser result:

- Before click: 8 quick-switch rows.
- Clicked: `1514`.
- After 5.2 seconds: header stayed `1514`.
- Selected row stayed `1514`.
- K-line iframe stayed on `symbol=1514`.
- Iframe `src` mutation count: `1`.
- Body horizontal overflow: none.

Screenshot:

- `evidence/w7_paper_sprint/trading-room-stale-refresh-guard-local-20260531.png`

Note: localhost backend proxy logs expected auth errors because owner cookies are production-domain scoped. This evidence verifies UI switch stability. Production verification is required after deploy.
