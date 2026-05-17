# 2026-05-18 Frontend cycle 0117 - Market heatmap industry labels

Owner: Codex frontend (`apps/web`)
Scope: `/market-intel` vendor frame heatmap labels

## Latest merged state

- `origin/main` is at `e4301e6` (`feat(api): OpenAlice ToolCenter Phase A`).
- Recent relevant merged work:
  - `#642` / `897097b` activated `/companies?tab=graph`.
  - `d76e680` fixed the company page left-column blank gap.
  - `40db79e` added company detail Coverage knowledge and industry graph panels.
  - `4a6c75f`, `23d2947`, `e3c64ff`, `e4301e6` moved OpenAlice/news/backend work forward.
  - `f1e2f14` reverted the heatmap EOD enrichment that hurt UX.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest main deploy for `e4301e6` is pending at the time of this note.
- Previous deploy for `896c3a4` succeeded, which already included `#642`.

## Blocked items and owners

- Heatmap stock universe, fixed watchlist membership, KGI/TWSE fallback semantics, and sector coverage counts remain Elva/Jason/API-owned.
- Frontend can safely fix only display labels and presentation around the returned heatmap data.
- Owner-session production verification still requires a valid owner session if production auth blocks browser smoke.

## Chosen frontend-safe task

Fix the market-intel heatmap label leak where returned `tile.industry` values are rendered raw. The existing app already has `industryLabel()` / `INDUSTRY_LABEL_MAP`, but `apps/web/lib/final-v031-live.ts` does not apply it in either server-side payload mapping or browser-side refresh mapping.

This is a bounded UI i18n fix: no data source changes, no heatmap stock selection changes, no broker/risk/contracts changes, and no vendor homepage layout rewrite.
