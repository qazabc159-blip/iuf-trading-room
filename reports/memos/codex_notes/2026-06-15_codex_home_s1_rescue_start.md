# Codex / Elva / Jason / Bruce sync - 2026-06-15

- Latest merged state: `origin/main` is `3afd15f8` (`#1073`); recent work includes F-AUTO valuation/status, weekly review, candidate-pool, alert unification, auto-deploy, and CI gate repairs.
- Open PRs: none at cycle start.
- Production truth: API health is green. Published daily brief, 8 AI recommendations, S1 scheduler status, 8-position EOD valuation, and accepted KGI SIM order audit rows all exist.
- Product breakage: homepage uses 3-second soft deadlines while issuing many expensive requests concurrently, so valid brief/recommendation data is falsely rendered as missing. The F-AUTO page reads empty off-hours gateway positions/funds above durable EOD/audit holdings, and its order parser drops `shares` and `submitted_at_tst`.
- Ownership: Codex owns the web fixes and browser verification. Elva/Jason retain KGI gateway, S1 execution, Lab, broker/risk, and live-order paths. No live-order promotion or KGI live write is in scope.
- Chosen task: restore homepage brief/recommendation/S1 truth, then make the S1 SIM observability surface show durable positions, capital, cash, P&L, and accepted order history with honest settlement status.
