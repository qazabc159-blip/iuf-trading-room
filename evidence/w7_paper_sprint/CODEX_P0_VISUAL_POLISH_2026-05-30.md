# Codex P0 Visual Product Polish — 2026-05-30

## Scope

Frontend-only product fixes for user-visible P0 polish:

- Core/sector heatmap compact tiles must show company names, not ticker-only boxes.
- Market Intel final-v031 industry heatmap must use Taiwan polarity: up = red, down = green.
- AI daily brief preview must not expose raw English section headings (`Market Overview`, `Theme Summaries`, `Company Notes`) as product copy.
- Market Intel institutional panel must not be blank or a vague "syncing" line when data is unavailable.
- Homepage tactical sidebar must expose the OpenAlice admin links directly.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test -- app/components/industry-heatmap-representatives.test.ts lib/final-v031-paper-ticket.test.ts app/page-p0-visual-copy.test.ts`

Vitest result: 25 files / 217 tests passed.

## Browser Smoke

Local Next dev server: `http://localhost:3300`

Screenshots:

- `evidence/w7_paper_sprint/p0-visual-home-auth-20260530.png`
- `evidence/w7_paper_sprint/p0-visual-market-intel-auth-20260530.png`

Machine-readable smoke:

- `evidence/w7_paper_sprint/p0-visual-polish-smoke-auth-20260530.json`

Browser observations:

- Homepage owner-session route opened without redirect.
- Homepage OpenAlice links are visible: Brain, EventLog, Portfolio, Tools, UTA, Strategies.
- AI brief preview no longer exposes the raw English section headings checked by the regression test.
- Market Intel iframe institutional panel now renders a formal degraded state with source/owner/next action instead of a blank/syncing-only area.
- Local Market Intel iframe had no local heatmap data in this worktree, so heatmap polarity is guarded by source tests and should be verified again on production after deploy.

## Remaining Separate P0

Trading-room K-line quality is not fixed in this PR. It is a separate root-cause task because `/portfolio` uses the final-v031 trading-room renderer instead of the company-page `OhlcvCandlestickChart` path. Next PR should either reuse the company-page chart path or replace the final-v031 chart with real OHLCV + zoom/scale controls.
