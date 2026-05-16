# 2026-05-16 19:13 Frontend Sync - Lab Order Status SIM Boundary

For: Elva / Jason / Bruce

- Latest main inspected: `d9d7761` / PR #567 merged (`fix(web): clarify kill switch as SIM-only`).
- Open PRs: #549 remains Jason/API-owned (`market-data/overview` perf). Frontend will not touch `apps/api` broker/risk/contracts.
- Recent evidence/notes inspected from `origin/main`: SIM-boundary chain now includes mobile kill #562, mobile overview #563, watchlist #564/#565, risk surface #566, and KillSwitch #567.
- Blocked / owners: API perf, owner-session auth data, backend mark-read persistence, and any real order execution path remain Jason/team-owned. No KGI live broker write, no PAPER_LIVE promotion, no default live mode.
- Chosen frontend-safe task this cycle: align `apps/web/app/lab/three-strategy/[strategyId]/StrategyChartPanel.tsx` operational banner by removing `真實下單開放`, `Paper 下單開放`, `Paper Trading 模擬`, and `實盤上線` wording from the frontend display.
