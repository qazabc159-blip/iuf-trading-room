# CODEX AI Handoff Prefill Copy PR - 2026-05-17

## Scope
- Branch: `fix/web-ai-handoff-prefill-copy-pr-2026-05-17`
- Base: `origin/main` at `3abd0d5` (`fix(web): trap quant subscribe modal focus (#581)`)
- Frontend-owned change only:
  - `apps/web/app/ai-recommendations/RecommendationHandoffLink.tsx`
  - `apps/web/lib/final-v031-live.ts`
- No API, broker, risk, contract, or order-path changes.

## Shipped
- Polished the AI recommendation handoff title/ARIA copy so `/ai-recommendations -> /portfolio` says the handoff opens a SIM preview and does not create broker orders.
- Updated the paper trading room prefill banner to state that it only creates simulated records and will not create broker orders.
- Added `role="status"` and `aria-live="polite"` to the prefill banner.
- Updated the prefill submit preview label and post-preview chart labels to use clear Traditional Chinese labels: `進場`, `停損`, `目標`.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` - pass
- `pnpm.cmd --filter @iuf-trading-room/contracts build` - pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - pass

## Browser Smoke
- Dev server: `http://127.0.0.1:3067`
- Target: `/api/ui-final-v031/paper-trading-room?ticker=2330&prefill=true&from_rec=REC-SMOKE-2330&entry=950&stop=920&tp=985&rev=handoff-smoke`
- Context: the authenticated `/portfolio` page is the shell that frames this same paper trading room route.
- Backend proxy handling: browser route stubbed `/api/ui-final-v031/backend` because local `apps/api` is outside this frontend-owned cycle.
- Viewport: `1366x900`
- Assertions:
  - Prefill banner includes `AI RECOMMENDATION SIM PREVIEW`.
  - Prefill banner includes `2330 已帶入交易室 SIM 預覽`.
  - Prefill banner includes `此區只建立模擬紀錄，不會建立券商委託`.
  - Prefill meta includes `進場 950`, `停損 920`, `目標 985`, and `rec REC-SMOKE-2330`.
  - Prefill banner has `role="status"` and `aria-live="polite"`.
  - Submit label is `AI 推薦帶入的 SIM 預覽`.
  - Chart labels include `進場 950`, `停損 920`, and `目標 985`.
  - Browser console errors/warnings: `0`.
  - Page errors: `0`.
  - Failed requests: `0`.
  - HTTP 4xx/5xx responses: `0`.

## Artifact
- Screenshot: `evidence/w7_paper_sprint/ai-handoff-prefill-copy-1366x900.png`
