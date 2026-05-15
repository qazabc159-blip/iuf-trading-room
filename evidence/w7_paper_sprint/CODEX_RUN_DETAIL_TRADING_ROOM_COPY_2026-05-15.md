# CODEX_RUN_DETAIL_TRADING_ROOM_COPY_2026-05-15

Cycle: 2026-05-15 21:18 TST
Branch: `fix/web-run-detail-trading-room-copy-2026-05-15`
Worktree: `IUF_TRADING_ROOM_APP_run_detail_trading_room_copy_worktree`

## Scope

Frontend-only product wording and handoff fix for `/runs/[id]`.

## Problem

Yang explicitly clarified that company pages should not host simulated ordering; trading and order preview belong in `交易室`.

Source scan found stale copy on strategy run detail:

- `策略想法尚未開放轉入模擬委託；目前只能進公司頁做紙上預覽與風控檢查。`
- Page note saying candidates can go to company page for `紙上預覽`.
- CTA linked to `/companies/:symbol#paper-order`.

That conflicts with the current product rule: company page = information/research, trading room = order workflow.

## Shipped locally

Updated `apps/web/app/runs/[id]/page.tsx`:

- Promotion blocked tooltip now says direct transfer is paused and users should re-check risk/order conditions in `交易室`.
- Secondary copy changed from `等待紙上預覽交接` to `等待交易室交接`.
- Page note now says company page is for research data, while simulated preview and risk checks belong in `交易室`.
- Candidate CTA changed from `紙上預覽` to `帶到交易室`.
- CTA target changed from `/companies/:symbol#paper-order` to `/portfolio?ticker=:symbol&prefill=true&from_run=true`.
- Trading boundary copy now says preview/risk/order execution is handled only in `交易室`.

No backend contract changes.

## Verification

Dependency setup in the clean worktree:

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
```

Typecheck:

```powershell
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Static safety check:

- No `apps/api` changes.
- No broker/risk/contracts changes.
- No戰情台 homepage layout change.
- `/runs/[id]` still links company research to `/companies/:symbol`; only the simulated preview handoff moved to `/portfolio`.

## Release status

Patch was prepared locally on the 2026-05-15 cycle.

2026-05-16 follow-up: promoted onto latest `origin/main` on branch
`fix/web-run-detail-trading-room-copy-2026-05-16`; see
`CODEX_RUN_DETAIL_TRADING_ROOM_COPY_PR_2026-05-16.md` for the current PR
verification and browser smoke.
