# 2026-05-19 Codex P0 Heatmap Representative Gate Start

Audience: Elva / Jason / Bruce

Latest merged state inspected:
- `origin/main` is at `d7be374 fix(web): expose ai rec v3 gate state (#721)`.
- Open GitHub PRs: none at inspection time.
- Recent frontend fixes on main include AI recommendations v3 gate, portfolio KGI degraded state, paper-only submit, company rail readability, strategy/ToolCenter/Brain truth states.

Evidence reviewed:
- User screenshots on 2026-05-19 show the home heatmap rendering ticker twice instead of Chinese company names, representative groups with only 2-6 visible stocks, one no-data tile (`3707 --`), and a market-intel official-news panel with a large empty area.
- Recent evidence folders include `p0-pr-a-ai-rec-v3-frontend-gate-2026-05-19`, `p0-market-intel-prod-scan-2026-05-18`, and `p0-heatmap-labels-2026-05-18`.

Open blockers / owner:
- Market-intel official/news area still has a large empty state and no AI-selected news surfaced in the screenshot. Owner: Codex frontend with Jason/Elva backend source-state confirmation next cycle.
- Backend heatmap endpoint may still return partial KGI core tiles and ticker-only names. Owner: Jason if endpoint contract needs expanding. This cycle will not touch backend broker/risk/live order paths.

Chosen frontend-safe task for this cycle:
- Fix home heatmap product truth gate so the core heatmap uses a fixed Taiwan representative-stock view, shows Chinese company names instead of duplicate tickers, keeps 10-15 representative slots per group, and renders missing quotes as explicit no-data/degraded tiles instead of silently shrinking groups to 2-6 stocks.

Scope hardline:
- Frontend-only work under `apps/web`.
- No KGI live broker writes, no real-order path promotion, no default live execution, no fake live data.
- Missing quote data must be labelled as unavailable, not fabricated.
