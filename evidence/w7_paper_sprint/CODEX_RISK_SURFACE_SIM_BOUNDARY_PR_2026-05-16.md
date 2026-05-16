# CODEX Risk Surface SIM Boundary PR Evidence - 2026-05-16

Cycle: 18:12 Asia/Taipei
Branch: `fix/web-risk-surface-sim-boundary-pr-2026-05-16`

## Scope

- Frontend-only safety copy fix in `apps/web/components/portfolio/RiskSurface.tsx`.
- Replaced risk-surface kill-switch status wording:
  - from `可交易`
  - to `SIM 檢查通過`
- Replaced risk-surface header wording:
  - from `交易模式`
  - to `執行模式`
- Did not touch `apps/api`, broker/risk/contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.

## Verification

Commands run from the clean PR worktree:

```text
git diff --check origin/main..HEAD
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
rg -n -e "可交易" -e "交易模式" -e "執行模式" -e "SIM 檢查通過" -e "PAPER_LIVE" -e "正式送單" -e "真實交易模式" -- apps/web/components/portfolio/RiskSurface.tsx
```

Result:

- `git diff --check`: PASS
- install: PASS, lockfile unchanged, offline cache reused
- contracts build: PASS
- web typecheck: PASS
- static copy scan: PASS
  - New `SIM 檢查通過` and `執行模式` text present.
  - Old `可交易` and `交易模式` text absent from `apps/web/components/portfolio/RiskSurface.tsx`.
  - No `PAPER_LIVE`, `正式送單`, or `真實交易模式` in the changed file.

## Browser Smoke

Dev server:

```text
pnpm.cmd --filter @iuf-trading-room/web exec next dev -H 127.0.0.1 -p 3036
```

Headless browser route smoke:

```text
GET http://127.0.0.1:3036/portfolio
```

Result:

- HTTP status: 200
- Unauthenticated route correctly redirects to `/login?next=%2Fportfolio`.
- Console errors: none
- Failed browser requests: none
- Login page did not contain old `可交易` or `交易模式` portfolio labels.
- Screenshot: `evidence/w7_paper_sprint/risk-surface-sim-boundary-1366x900.png`
- Dev warning observed: existing Sentry/OpenTelemetry critical dependency warning during instrumentation compile; not introduced by this copy-only change.

## Safety Notes

- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No PAPER_LIVE wording in changed file.
- No secrets or credentials.
- No backend broker/risk/contracts edits.
