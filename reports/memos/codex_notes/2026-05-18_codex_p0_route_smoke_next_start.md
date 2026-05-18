# 2026-05-18 Codex P0 Route Smoke Next Start

## Latest merged state

- `origin/main` is at `5863311 fix(web): clarify company page degraded states (#710)`.
- Recent frontend/product rescue merges:
  - #710 company page blocked/degraded state + company panel copy cleanup.
  - #709 portfolio trading room blocked states and no fake paper capital.
  - #708 announcements upstream switched to `t187ap11_L`.
  - #707/#705 heatmap sector label normalization follow-up.
  - #706 market intel AI news truth states.
  - #704 AI recommendation v3 panel.

## Open PRs

- Open PR list was empty at cycle start.

## Blocked items and owners

- Owner-session production company-page verification still needs Bruce/Elva cookies; Codex dummy-session QA only verifies the blocked/no-fake path.
- Any missing backend endpoint found during route smoke will be assigned to Jason/Elva, not patched blindly in frontend.

## Chosen frontend-safe task

- Run a production P0 route/capability smoke across the main navigation routes from Yang's acceptance list.
- Output an updated evidence artifact, then choose the next single highest-value frontend-owned fix from the failures found.
- Do not start a broad rewrite; this is route truth audit followed by one bounded fix.
