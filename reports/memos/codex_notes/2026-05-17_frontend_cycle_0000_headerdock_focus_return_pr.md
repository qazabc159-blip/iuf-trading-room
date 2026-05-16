# 2026-05-17 00:00 Frontend Cycle Sync - HeaderDock Focus Return

## Latest merged state
- `origin/main` is at `59e5567 fix(web): improve header dock bell accessibility (#576)`.
- Recent merged frontend PRs covered HeaderDock bell a11y (#576), AI handoff SIM preview clarity (#575), AI detail source labels (#574), radar Lab live-label closure (#573), and login SIM-broker copy (#572).

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked items / owners
- Production owner-session QA still needs authenticated/deployed environment confirmation. Owner: Elva/Yang.
- Notification production persistence and backend mark-read behavior remain Jason-owned when backend exposes the final live lane.
- No frontend blocker for this cycle.

## Chosen frontend-safe task
- Improve HeaderDock drawer keyboard/focus behavior: focus the drawer close button on open, close with Escape/scrim/close button, and return focus to the bell/system trigger after closing.
- Scope is limited to `apps/web/components/header-dock.tsx` plus evidence. No API, broker/risk contracts, Lab, shared contracts, or home layout changes.
