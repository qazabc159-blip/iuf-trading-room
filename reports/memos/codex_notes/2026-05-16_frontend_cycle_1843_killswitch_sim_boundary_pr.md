# 2026-05-16 18:43 Frontend Sync - KillSwitch SIM Boundary

For: Elva / Jason / Bruce

- Latest main inspected: `78fd8db` / PR #566 merged (`fix(web): clarify risk surface execution mode`).
- Open PRs: #549 remains Jason/API-owned (`market-data/overview` perf). Frontend will not touch `apps/api` broker/risk/contracts.
- Recent evidence/notes inspected from `origin/main`: SIM-boundary chain now includes mobile kill #562, mobile overview #563, watchlist gate #564, watchlist handoff #565, and risk surface #566.
- Blocked / owners: API perf, owner-session auth data, backend mark-read persistence, and any real order execution path remain Jason/team-owned. No KGI live broker write, no PAPER_LIVE promotion, no default live mode.
- Chosen frontend-safe task this cycle: align `apps/web/components/portfolio/KillSwitch.tsx` with the SIM-only chain by replacing `可交易` and `交易模式` wording with `SIM 檢查通過` / `執行模式` read-only copy.
