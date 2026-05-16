# CODEX LAB ORDER STATUS SIM BOUNDARY PR 2026-05-16

Cycle: 2026-05-16 19:13 Asia/Taipei

## Scope

- Frontend-only copy hardening for `apps/web/app/lab/three-strategy/[strategyId]/StrategyChartPanel.tsx`.
- Removed residual Lab operational banner wording that implied live/Paper order availability:
  - `真實下單開放`
  - `Paper 下單開放`
  - `Paper Trading 模擬`
  - `實盤上線`
- Replaced with SIM/research-safe status language:
  - `SIM 模擬觀察`
  - `Shadow Mode（不送單）`
  - `上線候選（券商寫入關閉）`
  - `正式券商寫入未開放`
  - `SIM 交接可檢查`
  - `交接狀態`

## Verification

- `git diff --check origin/main..HEAD` PASS.
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- Static scan PASS: changed file no longer contains `真實下單開放`, `Paper 下單開放`, `Paper Trading 模擬`, or `實盤上線`.
- Browser smoke PASS:
  - Dev server: `http://127.0.0.1:3038`
  - Route: `/lab/three-strategy/cont_liq_v36`
  - Result: redirected to `http://localhost:3038/login?next=%2Flab%2Fthree-strategy%2Fcont_liq_v36`, matching unauthenticated owner-session gate behavior.
  - Console errors: none.
  - Page errors: none.
  - Failed requests: none.
  - Screenshot: `evidence/w7_paper_sprint/lab-order-status-sim-boundary-1366x900.png`

## Safety

- No `apps/api` broker/risk/contracts edits.
- No `IUF_QUANT_LAB` or `IUF_SHARED_CONTRACTS` edits.
- No KGI live broker write path.
- No real-order path promotion.
- No default `executionMode='live'`.
- No `PAPER_LIVE` promotion or misleading paper/live wording introduced.
- No secrets, tokens, `DATABASE_URL`, KGI password, or identity leakage.
