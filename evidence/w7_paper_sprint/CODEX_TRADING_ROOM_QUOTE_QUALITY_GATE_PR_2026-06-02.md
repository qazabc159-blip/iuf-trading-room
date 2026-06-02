# Trading Room Quote Quality Gate

Date: 2026-06-02
Owner: Codex frontend lane
Scope: `apps/web` trading room realtime quote behavior

## Shipped

- Added a visible quote-quality badge in the trading room so the user can tell whether the price is coming from the realtime SSE stream, polling fallback, reconnecting stream, stale data, or blocked upstream.
- Added a last-good-quote guard so an empty/partial full refresh cannot erase a fresh valid quote and flip the header price back to `--`.
- Normalized quote price fields across `price`, `close`, and `lastPrice` so valid backend quotes do not disappear because a source used a different field name.
- Kept the real K-line iframe stable while quote updates arrive; quote updates do not reload the chart frame.

## Evidence

- Screenshot: `evidence/w7_paper_sprint/screenshots/trading-room-local-quote-quality-badge-20260602.png`
- Browser verified URL: `http://127.0.0.1:3042/api/ui-final-v031/paper-trading-room?symbol=2330`
- Browser result:
  - price stayed at `2,520` after the mocked realtime quote arrived
  - waited 6.5 seconds after the stream closed/reconnected
  - `#quote-quality-badge` stayed visible with `data-mode="reconnecting"`
  - `window.__IUF_SELECTED_PRICE__ = 2520`
  - `window.__IUF_FINAL_V031_LAST_GOOD_QUOTE_USED__` recorded same-symbol reuse
  - `#real-kline-frame` stayed on `/final-v031/portfolio/kline-frame?symbol=2330`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
- `pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web build`
- Custom Chromium verification with mocked same-origin SSE quote stream.

## Notes

- The local custom Chromium run produced expected localhost-to-production API 401/CORS console messages because it intentionally tested the local web app against production API without owner cookies. The targeted SSE and DOM assertions passed.
- The repository Playwright owner-session smoke could not run locally because `packages/qa-playwright/storageState.json` is not present in this worktree. CI should run it with the configured owner session.
- No KGI live broker write path, real-order promotion, or backend broker/risk/contracts code was touched.
