# 2026-05-18 Frontend cycle 0910 - Admin UTA SIM safety

Owner: Codex frontend (`apps/web`)
Scope: `/admin/uta/accounts` visible safety wording

## Latest merged state

- `origin/main` is at `a0e5a84` (`fix(ci): update prod migration expected count to 40`, PR #667).
- Recent shipped frontend state:
  - `#666` clarified AI recommendation feedback as `已帶入 SIM`.
  - `#663` / `#665` / `#667` repaired and aligned prod migration verification; backend lane is being handled separately.
  - `989a33c` added the five OpenAlice admin dashboards, including UTA account visibility.

## Open PRs / team progress

- `#662` EventLog Outbox remains open and green, but it is API/migration-owned and should stay behind the backend migration verification lane.
- No frontend-owned PR is currently waiting for this cycle.

## Blocked items and owners

- EventLog Outbox deploy sequencing remains Jason/Elva-owned because it adds migration `0039`.
- Owner-session production verification remains Bruce/Elva-owned after Railway migration count 40 stabilizes.
- This frontend cycle does not touch `apps/api`, broker/risk/contracts, KGI write paths, real-order promotion, secrets, or OpenAlice source imports.

## Chosen frontend-safe task

Remove the unsafe `LIVE` label from `/admin/uta/accounts` order rows. The UTA dashboard is read-only, but displaying non-SIM rows as `LIVE` can look like a formal-order path is available. This cycle will relabel the column as safety mode and render non-SIM rows as blocked/read-only instead, while preserving all data fetching and layout behavior.
