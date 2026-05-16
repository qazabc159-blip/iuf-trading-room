# CODEX Portfolio SIM Frame Title PR - 2026-05-17

## Scope

- Updated `/portfolio` and its middleware rewrite target `/final-v031/portfolio` so the outer `FinalOnlyFrame` title no longer says `Paper Trading Room`.
- Handoff URLs with AI recommendation/prefill params now expose the accessible frame title `交易室 SIM 預覽（AI 推薦帶入）`.
- Plain portfolio entry exposes `交易室 SIM 預覽`.
- Preserved the existing `/api/ui-final-v031/paper-trading-room` route and query handoff behavior.

## Files

- `apps/web/app/portfolio/page.tsx`
- `apps/web/app/final-v031/portfolio/page.tsx`
- `reports/memos/codex_notes/2026-05-17_frontend_cycle_0104_portfolio_sim_title_pr.md`

## Safety

- No `apps/api`, broker, risk, contract, Lab, shared-contract, or tactical homepage changes.
- No live broker write path, no default live execution mode, no paper/live promotion, and no real-order promotion.
- The wording remains SIM/preview-only while keeping the historical internal `paper-trading-room` asset route unchanged.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke passed with local Next on `127.0.0.1:3055`, mock API on `127.0.0.1:3117`, and an `iuf_session` smoke cookie.

Browser smoke URL:

```text
http://127.0.0.1:3055/portfolio?ticker=2330&prefill=true&from_rec=rec_2330_20260517&entry=620&stop=590&tp=660
```

Assertions:

- `main.iuf-final-content-frame[aria-label]` = `交易室 SIM 預覽（AI 推薦帶入）`
- `iframe[title]` = `交易室 SIM 預覽（AI 推薦帶入）`
- iframe `src` remained `/api/ui-final-v031/paper-trading-room?...`
- handoff query preserved `ticker=2330`, `prefill=true`, `from_rec=rec_2330_20260517`, `entry=620`, `stop=590`, `tp=660`
- iframe loaded to `complete`
- handoff prefill box contained `AI RECOMMENDATION SIM PREVIEW`
- console errors: 0
- page errors: 0
- HTTP 4xx/5xx responses: 0

Note: Next dev emitted same-origin `net::ERR_ABORTED` request-failed events during the final-v031 iframe/dev refresh lifecycle, while the iframe document was complete and all assertions passed. No bad HTTP response, CORS error, or runtime exception was observed.

Screenshot:

- `evidence/w7_paper_sprint/portfolio-sim-frame-title-1366x900.png`
