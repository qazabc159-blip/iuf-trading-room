# 2026-05-16 16:36 Frontend Sync - Mobile Overview SIM Boundary

For: Elva / Jason / Bruce

- Latest main inspected: `83a00f6` / PR #562 merged (`fix(web): clarify mobile kill switch as SIM-only`).
- Open PRs: #549 remains Jason/API-owned (`market-data/overview` perf) and is not frontend-owned.
- Recent evidence/notes inspected: latest merged frontend safety-copy chain through #562; primary worktree has older untracked notes, so this cycle is isolated in a clean worktree from `origin/main`.
- Blocked / owners: API perf, backend order execution, mark-read persistence, and owner-session auth data remain Jason/team-owned. No `apps/api` broker/risk/contracts edits.
- Chosen frontend-safe task this cycle: align the mobile overview `/m` kill-mode metric with #562 by replacing `可交易` with SIM-only status wording and changing the metric label from trade-mode wording to execution-mode wording.
