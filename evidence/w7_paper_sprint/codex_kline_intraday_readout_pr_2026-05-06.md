# Codex K-line Intraday Readout PR - 2026-05-06

Status: READY FOR PR

Trade Capability Score: +1

## User-Visible Workflow Improved

- Company page K-line is no longer only a static proof that FinMind returned rows.
- When the operator switches from daily K to minute K, the default range is the latest 1 trading day instead of 5 trading days, so the 1-minute chart is immediately readable.
- Explicit 5 / 10 / 20-day intraday ranges remain available for deeper review.
- The chart now exposes a hover/readout ribbon with open, high, low, close, volume, and timestamp, so the operator can inspect an individual minute bar before preparing a paper ticket.

## Endpoint / Source

- Page: `/companies/[symbol]`
- API source: `/api/v1/companies/:symbol/kbar?days=20`
- Data source semantics: FinMind Sponsor KBar remains `LIVE`; no mock or fallback is promoted to live.

## Files Changed

- `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/codex_kline_intraday_20day_axis_pr_2026-05-06.md`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check -- apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx apps/web/app/globals.css evidence/w7_paper_sprint/codex_kline_intraday_20day_axis_pr_2026-05-06.md evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` PASS, CRLF warnings only

## Browser QA

Local production build was started on `http://127.0.0.1:3228` with production API base. A one-time authenticated Playwright session used the session cookie only in memory; no cookie value or credential was written to evidence.

Screenshot manifest:

- `evidence/w7_paper_sprint/local_visual_qa_kline_readout_2026-05-06/manifest.json`
- `evidence/w7_paper_sprint/local_visual_qa_kline_readout_2026-05-06/company2330_local_day.png`
- `evidence/w7_paper_sprint/local_visual_qa_kline_readout_2026-05-06/company2330_local_1min_default_1day_readout.png`
- `evidence/w7_paper_sprint/local_visual_qa_kline_readout_2026-05-06/company2330_local_5min.png`

Observed:

- `canvasCount=7`
- `visibleCanvasCount=7`
- no `no_kbar_rows`, `no_kbar_rows_for_recent_dates`, or minute-K empty marker
- after clicking 1-minute, active range is latest 1 trading day
- after clicking 5-minute, active buttons are 5-minute plus 1-day range
- readout ribbon shows close, timestamp, open, high, low, and volume

Known local-only QA note:

- Some client-side company-financial and paper endpoints show browser CORS errors on localhost because the production API CORS origin is `app.eycvector.com`; this did not block the server-rendered K-line verification and does not indicate a production K-line failure.

## Stop-Line Proof

- no token display or token file write
- no fake-live data
- no live submit
- no KGI / broker write-side change
- no migration / schema / destructive DB change
- no paper fill or risk-source change
- no buy/sell recommendation wording
- odd-lot / board-lot wording unchanged

## Next

Open PR and, after CI/deploy, repeat the same production smoke on `https://app.eycvector.com/companies/2330` to prove the readout/range improvement is live.
