# CODEX_HEATMAP_VISIBLE_REPS_PR_2026-05-29

## Scope

- Frontend heatmap representative pool hardening only.
- No API, KGI, SIM, migration, contract, or Lab changes.
- Goal: keep every heatmap sector in the fixed 10-15 visible-tile band without reintroducing gray no-data tiles.

## Root cause

The heatmap had fixed pools, but several pools only had 12-13 symbols. Because the UI correctly filters `sourceState="no_data"` rows, a sector could drop below 10 visible tiles when multiple representatives lacked verifiable quotes.

## Changes

- `MAX_TILES_PER_SECTOR`: 13 -> 15.
- Expanded each visible sector representative pool to exactly 15 fixed Taiwan tickers.
- Added finance sector mapping for the newly added finance representatives.
- Added a source-gate test that enforces 15-symbol fixed pools and the shipping fallback buffer.

## Evidence

- Production precheck JSON:
  `evidence/w7_paper_sprint/heatmap-probe-20260529/prod-sector-visible-counts.json`
- Production shipping screenshot:
  `evidence/w7_paper_sprint/heatmap-probe-20260529/prod-shipping-current.png`
- Production shipping DOM:
  `evidence/w7_paper_sprint/heatmap-probe-20260529/prod-shipping-dom.json`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- industry-heatmap-representatives`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web build`

## Notes

Local browser rendering on `127.0.0.1` cannot be used as final visual truth for this route because the local Next middleware/session and backend environment do not load the authenticated production market feed. Final screenshot verification must be repeated on production after deploy.

