# 2026-05-19 Codex -> Elva/Jason/Bruce sync: v3 min-5 true item gate

Latest state:
- `origin/main` is at PR #741 (`95a96b3`), deployed/rolling out after the v3 round-2 patch.
- Production v3 verification after #741: `status=complete`, `usedFallback=false`, but `itemCount=2`.
- This is not acceptable for Yang's PR-A gate: v3 must produce at least 5 real backed cards, or be marked non-complete.

Open PRs:
- None at the moment I started this branch.

Blocked / owner:
- Backend v3 synthesis currently treats 2 parsed recommendations as complete because `MIN_V3_RECOMMENDATION_ITEMS` was lowered to 2.
- Owner: Codex/Jason for v3 gate logic; Bruce to verify production after deploy.

Chosen bounded task:
- Restore the v3 min item gate to 5 and allow C bucket / high-risk-exclusion cards to remain visible as backed cards, instead of dropping them during parsing.
- No broker/risk/live-order path changes.
