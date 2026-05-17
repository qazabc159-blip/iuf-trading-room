# 2026-05-18 Frontend cycle 0034 - Company graph tab activation

Owner: Codex frontend (`apps/web`)
Scope: `/companies?tab=graph`

## Latest merged state

- `origin/main` is at `8cdf6fa` (`fix(ci): deploy workflow_run trigger after CI rename`).
- Recent merged production fixes on main:
  - `#635` / `7b2f27b` AI recommendation source-mode user-facing copy.
  - `#637` / `d98e0ed` KGI off-hours auto-switch plus `/heatmap` and `/news` redirects.
  - `#636` / `6ddeec7` announcements ingest boot catch-up plus news-top10 force-refresh admin support.
  - `#634` / `00bd61b` KGI heatmap EOD enrichment. Elva is actively investigating/regressing this area after Yang reported sector coverage collapse and English labels.
  - `#629` / `708f86d` OpenAlice Brain Phase A.

## Open PRs / team progress

- `#630` OpenAlice EventLog Phase A clean cherry-pick is open and API-owned. CI checks shown in `gh pr list` are green, but the PR remains open and previously showed merge friction.
- `#632` brief sanitizer coverage is open and API-owned. Status checks are not currently reported by `gh pr list`.
- Elva's hotfix worktree `IUF_TRADING_ROOM_APP` is on `hotfix/revert-pr634-v2-elva` and dirty across API/db/test files. I will not touch that worktree or the heatmap backend path.
- The user reported P0 product regressions: sector heatmap composition damaged, all-market heatmap English labels, company page blank space, and My-TW-Coverage knowledge graph still looking unfinished.

## Blocked items and owners

- Heatmap sector composition, KGI/TWSE fallback semantics, and all-market label localization are currently Elva/Jason/API hotfix territory. Frontend Codex should not race their dirty worktree.
- Announcement/news cron and backfill behavior remain Jason/API-owned after `#636`; frontend can only display honest status from existing responses.
- Production owner-session validation may still require Yang/Elva credentials or a prepared owner browser context.

## Chosen frontend-safe task

Activate the existing company graph tab instead of leaving the v2 stub. The frontend already has `getCompanyGraphStats()` and `searchCompanyGraph()` clients, so this cycle will consume those existing endpoints and show My-TW-Coverage graph stats, top connected companies, keywords, relation types, and search results.

This directly addresses the visible `/companies?tab=graph` blank/stub complaint without touching broker/risk/contracts, backend heatmap code, or Elva's active hotfix worktree.
