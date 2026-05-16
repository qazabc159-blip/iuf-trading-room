# CODEX LAB OWNER MODE SIM GUARD PR 2026-05-16

Cycle: 2026-05-16 19:44 Asia/Taipei

## Scope

- Frontend-only hardening for `apps/web/app/lab/three-strategy/[strategyId]/StrategyDetailClient.tsx`.
- Reframed the Owner governance panel from live-trading language to SIM-only governance language:
  - `交易模式切換（Owner）` -> `策略治理階段（Owner / SIM-only）`
  - visible segments: `研究`, `SIM`, `候選`
  - `Paper 模擬中` -> `SIM 模擬觀察`
  - amount label now says `SIM 分配金額（TWD 整數，非正式送單）`
- The frontend now keeps the candidate/LIVE enum path disabled with broker-write-closed copy and returns an inline error if that path is requested.
- The old confirmation modal copy was demoted from KGI/real-money language to candidate handoff copy and no longer claims broker execution.

## Verification

- `git diff --check` PASS.
- Static scan PASS: changed file no longer contains `真金`, `KGI 真實交易`, `真實資金`, `切換 LIVE`, `解鎖 LIVE`, `可切換 LIVE`, `Paper 模擬中`, `交易模式切換（Owner）`, `PAPER_LIVE`, or default live execution mode copy.
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- Browser smoke PASS:
  - Dev server: `http://127.0.0.1:3039`
  - Route: `/lab/three-strategy/cont_liq_v36`
  - Result: redirected to `http://localhost:3039/login?next=%2Flab%2Fthree-strategy%2Fcont_liq_v36`, matching unauthenticated owner-session gate behavior.
  - Console errors: none.
  - Page errors: none.
  - Failed requests: none.
  - Rendered unauthenticated page did not show old owner-mode copy.
  - Screenshot: `evidence/w7_paper_sprint/lab-owner-mode-sim-guard-1366x900.png`

## Safety

- No `apps/api` broker/risk/contracts edits.
- No `IUF_QUANT_LAB` or `IUF_SHARED_CONTRACTS` edits.
- No KGI live broker write path exposed.
- No real-order path promotion.
- No default `executionMode='live'`.
- No `PAPER_LIVE` promotion or misleading paper/live wording introduced.
- No secrets, tokens, `DATABASE_URL`, KGI password, or identity leakage.

## Residual

- Owner-authenticated visual confirmation still needs Yang/owner session credentials or production session QA. This PR covers static copy/behavior hardening plus unauthenticated route smoke only.
