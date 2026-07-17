# Pete (PR Reviewer) — Memory Index

- [熱力圖資料誠實 gating 審查 pattern](heatmap_data_honesty_gating_pattern.md) — 3-tier fallback 反覆病灶：某 tier 缺欄位卻冒充完整格；審查 3 要點
- [跨源取「較新日期」banner 的通用風險](banner_cross_source_date_consistency_risk.md) — 只驗日期新舊不驗資料完整度的模式；🟡 非 🔴 判準理由
- 環境備忘：本 repo 主 tree 常態髒（多 agent worktree 並行），review 一律用 `git diff origin/main...origin/<branch>` 對 refs 比對，不信 working tree；`git show <ref>:<path>` 讀單檔內容。
- 本輪案例：PR #1297（`fix/heatmap-data-honesty-gating-jason-20260717`，commit `3d6a07c1`）APPROVED，0 blocker，2 🟡。Evidence: `evidence/sprint_2026_07_17/pr1297_review.md`。
