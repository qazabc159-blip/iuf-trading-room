# CODEX Mobile Kill SIM Boundary PR Evidence - 2026-05-16

Cycle: 16:06 Asia/Taipei
Branch: `fix/web-mobile-kill-sim-boundary-pr-2026-05-16`

## Scope

- Frontend-only safety copy fix in `apps/web/app/m/kill/page.tsx`.
- Replaced the mobile kill-switch `trading` label from `可交易` to `SIM 檢查通過`.
- Replaced generic order copy with SIM-only copy:
  - `通過後端風控後，只允許建立模擬委託`
  - `不開啟正式券商寫入`
- Did not touch `apps/api`, broker/risk/contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.

## Verification

Commands run from the clean PR worktree:

```text
git diff --check origin/main..HEAD
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
rg -n "可交易|真實交易模式|SIM 檢查通過|只允許建立模擬委託|不開啟正式券商寫入|切換執行模式" apps/web/app/m/kill/page.tsx
```

Result:

- `git diff --check`: PASS
- install: PASS, lockfile unchanged, offline cache reused
- contracts build: PASS
- web typecheck: PASS
- static copy scan: PASS
  - New SIM-only text present.
  - Old `可交易` and `真實交易模式` text absent from `apps/web/app/m/kill/page.tsx`.

## Browser Smoke

Dev server:

```text
pnpm.cmd --filter @iuf-trading-room/web exec next dev -H 127.0.0.1 -p 3031
```

Headless browser route smoke:

```text
GET http://127.0.0.1:3031/m/kill
```

Result:

- HTTP status: 200
- Route redirects unauthenticated session to `/login?next=%2Fm%2Fkill` as expected.
- Console errors: none
- Failed browser requests: none
- Screenshot: `evidence/w7_paper_sprint/mobile-kill-sim-boundary-390x844.png`
- Dev warning observed: existing Sentry/OpenTelemetry critical dependency warning during instrumentation compile; not introduced by this copy-only change.

## Safety Notes

- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No PAPER_LIVE wording.
- No secrets or credentials.
- No backend broker/risk/contracts edits.
