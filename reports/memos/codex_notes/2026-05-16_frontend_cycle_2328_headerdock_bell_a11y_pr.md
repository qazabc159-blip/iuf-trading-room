# 2026-05-16 23:28 Frontend Cycle Sync - HeaderDock Bell A11y

## Latest merged state
- `origin/main` is at `5e66f73 fix(web): clarify ai handoff sim preview (#575)`.
- Recent merged frontend PRs covered AI detail source labels (#574), radar Lab live-label closure (#573), login SIM-broker copy (#572), and SIM event status copy (#571).

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked items / owners
- Production owner-session QA still needs authenticated/deployed environment confirmation. Owner: Elva/Yang.
- Notification production persistence and backend mark-read behavior remain Jason-owned when backend exposes the final live lane; frontend keeps same-origin proxy/readiness only.
- No frontend blocker for this cycle.

## Chosen frontend-safe task
- Improve HeaderDock bell/drawer accessibility and mark-read readiness semantics: make the bell announce unread/loading/error state and make notification links expose read state, severity, title, category/time, and summary to assistive tech.
- Scope is limited to `apps/web/components/header-dock.tsx` plus evidence. No API, broker/risk contracts, Lab, shared contracts, or home layout changes.
