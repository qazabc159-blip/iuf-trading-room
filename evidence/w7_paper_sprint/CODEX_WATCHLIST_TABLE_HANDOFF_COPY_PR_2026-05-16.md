# CODEX Watchlist Table Handoff Copy PR Evidence - 2026-05-16

Cycle: 17:39 Asia/Taipei
Branch: `fix/web-watchlist-handoff-sim-copy-pr-2026-05-16`

## Scope

- Frontend-only safety copy fix in `apps/web/components/watchlist/WatchlistTable.tsx`.
- Replaced the watchlist table handoff header:
  - from `轉單`
  - to `模擬交接`
- Replaced tooltip/reason wording:
  - `不能轉入模擬委託。` -> `不能建立模擬交接。`
  - `轉入模擬委託仍暫停` -> `模擬交接仍暫停`
- Did not touch `apps/api`, broker/risk/contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.

## Verification

Commands run from the clean PR worktree:

```text
git diff --check origin/main..HEAD
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
rg -n -e "轉單" -e "轉入模擬委託" -e "模擬交接" -e "PAPER_LIVE" -e "正式送單" -e "真實交易模式" -- apps/web/components/watchlist/WatchlistTable.tsx
```

Result:

- `git diff --check`: PASS
- install: PASS, lockfile unchanged, offline cache reused
- contracts build: PASS
- web typecheck: PASS
- static copy scan: PASS
  - New `模擬交接` text present.
  - Old `轉單` and `轉入模擬委託` text absent from `apps/web/components/watchlist/WatchlistTable.tsx`.
  - No `PAPER_LIVE`, `正式送單`, or `真實交易模式` in the changed file.

## Browser Smoke

Dev server:

```text
pnpm.cmd --filter @iuf-trading-room/web exec next dev -H 127.0.0.1 -p 3035
```

Headless browser route smoke:

```text
GET http://127.0.0.1:3035/
```

Result:

- HTTP status: 200
- Unauthenticated route correctly redirects to `/login?next=%2F`.
- Console errors: none
- Failed browser requests: none
- Login page did not contain old `轉單` text.
- Screenshot: `evidence/w7_paper_sprint/watchlist-table-handoff-copy-1366x900.png`
- Dev warning observed: existing Sentry/OpenTelemetry critical dependency warning during instrumentation compile; not introduced by this copy-only change.

## Safety Notes

- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No PAPER_LIVE wording in changed file.
- No secrets or credentials.
- No backend broker/risk/contracts edits.
