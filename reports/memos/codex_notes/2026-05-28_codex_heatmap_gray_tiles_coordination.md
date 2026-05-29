# Codex heatmap rescue coordination - 2026-05-28 21:30 TST

## Latest state checked

- `origin/main`: `8e99fd0 fix(web): read EventLog root response payloads (#763)`.
- Open PRs observed:
  - `#764 fix(api): retry market intel AI selector` - Market Intel / AI news lane, do not touch.
  - `#765 fix(web): proxy company coverage reads` - company coverage lane, do not touch.
  - `#757 feat(strategy): V3 7-axis...` - conflicting backend/schema lane, do not touch.
- Elva lane: F-AUTO / S1 / KGI SIM readiness and rescued SIM work; avoid `apps/api/src/server.ts`, `tests/ci.test.ts`, contracts, migrations, and `IUF_QUANT_LAB`.

## P0 chosen task

Fix the homepage Taiwan industry heatmap fixed representative pools. Root cause found in the homepage data flow: once the 40-stock KGI core feed exists, the page stops passing `/api/v1/market-data/overview` rows into the industry heatmap. The KGI core feed is too small for every sector's fixed 10-15 representative pool, so the component had to render synthetic `sourceState="no_data"` placeholders for missing names.

## Scope

- Frontend-only heatmap rendering.
- Keep fixed Taiwan representative pools intact.
- Merge KGI core quotes with the full market overview representative feed.
- Preserve Chinese company names and sector labels from market overview when KGI rows only carry ticker names.
- Do not fake missing quotes.
- Do not render missing representative stocks as visible gray treemap tiles.
- Show a concise missing-data note only when a representative is genuinely absent from both real feeds.

## Verification target

- Heatmap unit/source gate updated.
- Web typecheck.
- Browser evidence: core pool 37 real tiles, semiconductor 10, communication 12, finance 11, all with 0 gray no-data tiles.
- Evidence under `evidence/w7_paper_sprint`.
