# CODEX Watchlist Surface SIM Boundary PR Evidence - 2026-05-16

Cycle: 17:09 Asia/Taipei
Branch: `fix/web-watchlist-sim-boundary-pr-2026-05-16`

## Scope

- Frontend-only safety copy fix in `apps/web/components/watchlist/WatchlistSurface.tsx`.
- Replaced the watchlist gate label for backend `trading` state:
  - from `可交易`
  - to `SIM 檢查通過`
- Kept the change intentionally scoped to the watchlist surface header. Watchlist table handoff copy and portfolio risk copy remain separate follow-up tasks.
- Did not touch `apps/api`, broker/risk/contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.

## Verification

Commands run from the clean PR worktree:

```text
git diff --check origin/main..HEAD
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
rg -n -e "可交易" -e "SIM 檢查通過" -e "PAPER_LIVE" -e "真實交易模式" -e "executionMode='live'" -e "executionMode=\"live\"" -- apps/web/components/watchlist/WatchlistSurface.tsx
```

Result:

- `git diff --check`: PASS
- install: PASS, lockfile unchanged, offline cache reused
- contracts build: PASS
- web typecheck: PASS
- static copy scan: PASS
  - New `SIM 檢查通過` text present.
  - Old `可交易` text absent from `apps/web/components/watchlist/WatchlistSurface.tsx`.
  - No `PAPER_LIVE`, `真實交易模式`, or default live execution mode in the changed file.

## Browser Smoke

Dev server:

```text
pnpm.cmd --filter @iuf-trading-room/web exec next dev -H 127.0.0.1 -p 3034
```

Headless browser route smoke:

```text
GET http://127.0.0.1:3034/
```

Result:

- HTTP status: 200
- Unauthenticated route correctly redirects to `/login?next=%2F`.
- Console errors: none
- Failed browser requests: none
- Login page did not contain old `可交易` text.
- Screenshot: `evidence/w7_paper_sprint/watchlist-surface-sim-boundary-1366x900.png`
- Dev warning observed: existing Sentry/OpenTelemetry critical dependency warning during instrumentation compile; not introduced by this copy-only change.

## Safety Notes

- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No PAPER_LIVE wording in changed file.
- No secrets or credentials.
- No backend broker/risk/contracts edits.
