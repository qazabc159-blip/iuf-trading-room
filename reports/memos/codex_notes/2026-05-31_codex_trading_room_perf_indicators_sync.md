# 2026-05-31 Codex Sync - Trading Room Performance + Indicators

Latest merged state:
- `origin/main` is at `d9d2ea0a` / PR #846, which fixed the trading room K-line readout clipping after PR #842 and PR #844 stabilized the frame and layout.
- Production verification after #846 showed no outer/right-panel scrollbars and stable K-line iframe source, but first usable render still measured around 9.6s and the chart interactions/indicator UX still need product-grade work.

Open PRs:
- #847 `fix(web): align brief dispatcher with template gate` is unrelated to this trading-room lane.

Coordination:
- Elva/Jason lane remains KGI SIM / F-AUTO / backend gateway. This task will not touch `apps/api/src/server.ts`, `tests/ci.test.ts`, contracts, migrations, KGI broker write paths, or `IUF_QUANT_LAB`.
- Other Codex lanes have been working on market intel / AI / ToolCenter. This task stays on `/portfolio` trading room only.

Chosen frontend-safe task:
- Improve `/portfolio` trading room performance and K-line usability without hiding features: reduce initial blank time, prevent redundant K-line frame reloads, and make timeframe/indicator controls reflect real data state instead of decorative buttons.

Verification target:
- Run web typecheck/tests and a production or local browser smoke for `/portfolio?symbol=2330`, including first visible time, iframe stability, console/network errors, and indicator/timeframe interactions.
