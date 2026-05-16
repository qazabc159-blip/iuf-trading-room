# CODEX AI Handoff SIM Preview PR - 2026-05-16

Cycle: 2026-05-16 22:56 Asia/Taipei

## Scope

- Frontend-only polish for the `/ai-recommendations -> /portfolio` landing flow.
- Updated the final-v031 trading room AI prefill box to say `AI RECOMMENDATION SIM PREVIEW`.
- Updated the handoff submit label to say `AI 推薦已帶入 SIM 預覽`, including after the vendor `updPreview()` function rewrites the submit button content.
- Stabilized the portfolio iframe `rev` value from `Date.now()` to a handoff-query-derived key.
- Fixed the Sidebar active state hydration mismatch by rendering active route state only after mount.

## Files

- `apps/web/lib/final-v031-live.ts`
- `apps/web/app/portfolio/page.tsx`
- `apps/web/app/final-v031/portfolio/page.tsx`
- `apps/web/components/Sidebar.tsx`

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed after the handoff copy change.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed after the Sidebar and iframe `rev` fixes.
- Python Playwright browser smoke against local web `http://127.0.0.1:3050` and local mock API `http://127.0.0.1:3112`:
  - Opened `/portfolio?ticker=2330&prefill=true&from_rec=rec_2330_20260516&entry=910-925&stop=885&tp=950`.
  - Added local-only `iuf_session=local-smoke-session` cookie for middleware routing.
  - Confirmed iframe route used stable `rev=handoff-...`.
  - Confirmed the handoff box rendered `AI RECOMMENDATION SIM PREVIEW`.
  - Confirmed the handoff copy rendered `2330 已帶入交易室 SIM 預覽`.
  - Confirmed meta chips: `進場 910-925`, `停損 885`, `目標 950`, and `rec rec_2330_20260516`.
  - Confirmed submit label: `AI 推薦已帶入 SIM 預覽`.
  - Confirmed no browser console errors and no page errors after the Sidebar hydration fix.
  - Confirmed no bad HTTP responses.
  - Observed `net::ERR_ABORTED` requestfailed events from final-v031 iframe document refresh in the local Next dev environment; the page settled correctly and no 4xx/5xx responses occurred.

Screenshot:

- `evidence/w7_paper_sprint/ai-handoff-sim-preview-1366x900.png`

## Safety

- No `apps/api`, broker, risk, shared-contract, Lab, or homepage layout edits.
- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No `PAPER_LIVE`, formal order, broker-submit, or real-order wording introduced.
