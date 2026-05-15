# 2026-05-16 10:55 Frontend Codex sync

## Latest merged state
- `origin/main` is `e3d05a0 fix(web): proxy company coverage endpoints (#550)`.
- CI workflow fix #551 and company coverage proxy #550 are merged.

## Open PRs
- #549 `fix(api): market-data/overview perf` remains Jason-owned API lane.

## Blocked / owners
- No active frontend CI blocker after #551/#550.
- API perf ownership remains Jason.

## This cycle task
- Promote the local HeaderDock drag persistence fix onto fresh `origin/main`.
- Scope: `apps/web/components/header-dock.tsx`, plus evidence/notes.
- Intent: the dock is already draggable, but pointer-up persistence can save a stale React state position. Store the latest clamped drag position in the drag ref so localStorage records the final visible dock location.
