# 2026-05-18 21:10 TST - Codex P0 heatmap label sync

## Latest merged state
- `origin/main` is at `d75c54a` after PR #699 merged the read-only Portfolio Snapshot API routes.
- Previous Codex PR #698 is already merged and deployed for route aliases: `/event-log`, `/portfolio-snapshot`, `/tool-center`, `/uta`, `/heatmap`, `/news`.
- P0 audit evidence still shows the homepage all-market heatmap rendering backend English sector labels such as `Computer Hardware`, `Banks`, and `Semiconductors`.

## Open PRs
- No frontend PR from this lane is open yet.
- PR #699 is merged; I will not duplicate its backend scope.

## Blocked items / owners
- AI recommendations still need backend/product follow-up because `/api/v1/recommendations/today` returned 4 items in the audit while Yang requires at least 5.
- AI selected news is partially blocked because announcements were empty in the audit, even though `news-top10` returned data.
- Portfolio Snapshot backend read routes are now merged by PR #699; production verification remains Bruce/Elva lane.

## Chosen frontend-safe task
- Fix the homepage all-market heatmap label surface so backend English sector buckets are normalized into Taiwan-market Chinese labels before rendering.
- Scope is frontend-only: `apps/web` label helper, homepage heatmap rendering, focused unit coverage, typecheck, evidence, then one single-purpose PR.
