# CODEX KillSwitch SIM Boundary PR Evidence - 2026-05-16

Cycle: 18:43 Asia/Taipei
Branch: `fix/web-killswitch-sim-boundary-pr-2026-05-16`

## Scope

- Frontend-only safety copy fix in `apps/web/components/portfolio/KillSwitch.tsx`.
- Replaced the armed kill-switch card wording:
  - from `可交易`
  - to `SIM 檢查通過`
- Replaced generic mode copy:
  - `交易模式唯讀狀態` -> `執行模式唯讀狀態`
  - `切換交易模式` -> `切換執行模式`
  - `交易模式目前由系統控管` -> `執行模式目前由系統控管`
- Tightened the ARMED description to `模擬委託資格`.
- Did not touch `apps/api`, broker/risk/contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.

## Verification

Commands run from the clean PR worktree:

```text
git diff --check origin/main..HEAD
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
rg -n -e "可交易" -e "交易模式" -e "正式切換" -e "執行模式" -e "SIM 檢查通過" -e "PAPER_LIVE" -e "正式送單" -e "真實交易模式" -- apps/web/components/portfolio/KillSwitch.tsx
```

Result:

- `git diff --check`: PASS
- install: PASS, lockfile unchanged, offline cache reused
- contracts build: PASS
- web typecheck: PASS
- static copy scan: PASS
  - New `SIM 檢查通過`, `執行模式`, and `模擬委託資格` text present.
  - Old `可交易`, `交易模式`, and `正式切換` text absent from `apps/web/components/portfolio/KillSwitch.tsx`.
  - No `PAPER_LIVE`, `正式送單`, or `真實交易模式` in the changed file.

## Browser Smoke

Dev server:

```text
pnpm.cmd --filter @iuf-trading-room/web exec next dev -H 127.0.0.1 -p 3037
```

Headless browser route smoke:

```text
GET http://127.0.0.1:3037/portfolio
```

Result:

- HTTP status: 200
- Unauthenticated route correctly redirects to `/login?next=%2Fportfolio`.
- Console errors: none
- Failed browser requests: none
- Login page did not contain old `可交易` or `交易模式` portfolio labels.
- Screenshot: `evidence/w7_paper_sprint/killswitch-sim-boundary-1366x900.png`
- Dev warning observed: existing Sentry/OpenTelemetry critical dependency warning during instrumentation compile; not introduced by this copy-only change.

## Safety Notes

- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No PAPER_LIVE wording in changed file.
- No secrets or credentials.
- No backend broker/risk/contracts edits.
