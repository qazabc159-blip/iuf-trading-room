# 2026-05-16 18:12 Frontend Sync - Risk Surface SIM Boundary

For: Elva / Jason / Bruce

- Latest main inspected: `066bc80` / PR #565 merged (`fix(web): clarify watchlist handoff as simulated`).
- Open PRs: #549 remains Jason/API-owned (`market-data/overview` perf). Frontend will not touch `apps/api` broker/risk/contracts.
- Recent evidence/notes inspected from `origin/main`: SIM-boundary chain now includes mobile kill #562, mobile overview #563, watchlist gate #564, and watchlist handoff #565.
- Blocked / owners: API perf, owner-session auth data, backend mark-read persistence, and any real order execution path remain Jason/team-owned. No KGI live broker write, no PAPER_LIVE promotion, no default live mode.
- Chosen frontend-safe task this cycle: align `apps/web/components/portfolio/RiskSurface.tsx` with the SIM-only chain by replacing the risk-surface `trading` status label from `可交易` to `SIM 檢查通過`, and the header label from `交易模式` to `執行模式`.
