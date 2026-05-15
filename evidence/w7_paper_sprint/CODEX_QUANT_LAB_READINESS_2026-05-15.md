# CODEX_QUANT_LAB_READINESS_2026-05-15

Time: 2026-05-15 09:18 TST
Branch: `feat/web-quant-strategies-lab-readiness-2026-05-15`

## Scope

Frontend-only Day 4-5 readiness for `/quant-strategies`.

Changes:
- `/quant-strategies` now attempts read-only fetch of `GET /api/v1/lab/strategies` via existing `radarLabApi.strategies()`.
- Added a Lab sanctioned snapshot status panel.
- Added explicit fallback state when the Lab snapshot/API is unavailable.
- Merges matching Lab candidate status into local strategy cards without fabricating scores or execution state.
- Keeps SIM-only v1 copy and no live trading controls.
- Added optional `displayStatus` typing for Lab strategy candidates.

## Safety

Held hardlines:
- No KGI live write.
- No `PAPER_LIVE` promotion.
- No default live execution mode.
- No `apps/api` broker/risk/contracts edits.
- No `IUF_QUANT_LAB` or `IUF_SHARED_CONTRACTS` edits.
- No fake quant score; score remains `讀取中` until a formal quant-strategies endpoint returns it.

## Verification

Commands:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` -> PASS
- `curl.exe -I -H "Cookie: iuf_session=dev" http://localhost:3021/quant-strategies` -> HTTP 200
- Browser smoke desktop `1440x1100` -> PASS
- Browser smoke mobile `390x900` -> PASS

Observed:
- Page title: `量化策略`
- Strategy cards: 3
- SIM-only banner visible
- Lab snapshot panel visible
- Local dev with no API base/session shows fallback `Lab 候選策略暫未同步` instead of blank page

Screenshots:
- `evidence/w7_paper_sprint/CODEX_QUANT_LAB_READINESS_2026-05-15.png`
- `evidence/w7_paper_sprint/CODEX_QUANT_LAB_READINESS_MOBILE_2026-05-15.png`

Residual:
- Local browser console still reports existing HeaderDock alerts CORS against `http://localhost:3001/api/v1/alerts?limit=50`. Not introduced by this PR; page content still renders.
- Owner-session production QA should confirm the Lab snapshot panel shows live `lab_sanctioned` metadata when authenticated API access is available.
