Status: READY FOR PR
Owner: Codex
Time: 2026-05-06 05:18 Taipei

# Paper Preview Reason I18N

## Trade Capability Score

+1

## User-Visible Workflow Improved

Company-page paper ticket preview already reaches the production paper preview endpoint, but blocked/warn guard messages came back in backend English. This patch translates the real guard reasons into Traditional Chinese so the operator can understand whether the draft is blocked by trading hours, missing formal quote, per-trade budget, or single-position exposure.

## Endpoint / Source Proof

Authenticated production preview checks were run with one-time session cookie in memory only:

- `POST /api/v1/paper/preview` for `1104`, `quantity_unit=SHARE`, `qty=1`, `price=28.25` returned HTTP 200 with `blocked=true`, `trading_hours` block, and `stale_quote` warning.
- `POST /api/v1/paper/preview` for `2330`, `quantity_unit=SHARE`, `qty=1`, `price=2250` returned HTTP 200 with `blocked=true`, `trading_hours` block, and `stale_quote` warning.
- `POST /api/v1/paper/preview` for `2330`, `quantity_unit=LOT`, `qty=1`, `price=2250` returned HTTP 200 with `trading_hours`, `max_per_trade`, and `max_single_position` blocks.

The test did not call submit and did not create a paper order.

## Behavior Change

- `trading_hours` now renders as `交易時段`.
- `max_per_trade` now renders as `單筆風控上限`.
- `max_single_position` now renders as `單一部位上限`.
- Backend message `Current time is outside allowed trading hours (09:00-13:30 Asia/Taipei).` now renders in Chinese and explicitly says preview/check only, no order submit.
- Backend message `No quote available for <symbol>.` now renders in Chinese and explicitly says FinMind / K-line is not used as a fill price.
- Backend messages for per-trade and single-position exposure render in Chinese.

## Screenshot / Manifest

No new screenshot is required for this code-only vocabulary patch before deploy; the production K-line and paper panel screenshot manifest from the same session is:

- `evidence/w7_paper_sprint/production_smoke_pass125_kline_1104_2330_2026-05-06/manifest.json`

Post-merge deploy smoke should click paper preview and capture the translated result panel.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check -- apps/web/lib/paper-order-vocab.ts evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` PASS with CRLF warnings only.

## Stop-Line Proof

- No token value displayed or written.
- No fake live data.
- No live submit.
- No KGI/broker write-side.
- No migration/schema/destructive DB.
- No FinMind/TradingView paper fill or risk source.
- No buy/sell recommendation wording.
