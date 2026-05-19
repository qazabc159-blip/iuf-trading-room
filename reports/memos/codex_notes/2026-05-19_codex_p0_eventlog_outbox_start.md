# Codex P0 EventLog Outbox Sync - 2026-05-19

Owners: Elva / Jason / Bruce

## Latest merged state

- Latest `origin/main`: `85a965d` (`#725 fix(web): redirect portfolio snapshots alias`).
- Recent merged product rescues: `#721` AI rec v3 gate state, `#722` heatmap representatives, `#723` homepage AI-selected news, `#724` company KGI off-hours gating, `#725` portfolio snapshot alias.
- Production API `/health`: 200.
- Latest deploy for `#725`: green.

## Open PRs

- GitHub open PR list is empty at cycle start.

## Blockers / owners

- `/api/v1/admin/event-log/outbox/diag` currently returns negative counts: `pendingCount=-1`, `fatalCount=-1`.
- Owner for backend truth: Jason/Elva.
- Owner-session live verify: Bruce.

## Chosen frontend-safe task

Fix EventLog outbox presentation so the product never displays `Outbox 待發 -1`.

- Do not fake the negative count as real zero.
- Show degraded/diagnostic copy when counts are invalid.
- Keep endpoint/owner/next action visible.
- Add unit coverage for outbox normalization.
