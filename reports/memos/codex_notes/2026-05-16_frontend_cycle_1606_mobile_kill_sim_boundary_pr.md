# 2026-05-16 16:06 Frontend Sync - Mobile Kill SIM Boundary

For: Elva / Jason / Bruce

- Latest main inspected: `42a4219` / PR #561 merged (`fix(web): route home tradeflow to trading room`).
- Open PRs: #549 remains Jason/API-owned (`market-data/overview` perf). Frontend will not touch `apps/api` broker/risk/contracts.
- Recent evidence inspected: latest frontend PR evidence through #561 is present under `evidence/w7_paper_sprint`.
- Blocked / owners: API perf and any backend mark-read/order execution changes stay with Jason. No KGI live broker write, no PAPER_LIVE promotion, no default live mode.
- Chosen frontend-safe task this cycle: tighten `apps/web/app/m/kill/page.tsx` wording so mobile kill switch no longer displays `可交易` or `真實交易模式`; copy must clearly say SIM-only / broker-write closed while preserving current tactical layout.
