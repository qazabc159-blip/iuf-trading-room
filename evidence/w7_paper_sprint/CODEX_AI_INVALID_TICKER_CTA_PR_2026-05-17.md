# CODEX AI invalid ticker CTA PR - 2026-05-17

## Scope

- Frontend-owned fix in `apps/web`.
- Task: keep invalid Recommendation Orchestrator ticker values from producing active `/portfolio` handoff links in `/ai-recommendations` and `/ai-recommendations/[id]`.
- Safety: no `apps/api`, broker, risk, contracts, KGI, live-order, or homepage layout changes.

## Change

- Added shared AI recommendation handoff helpers in `apps/web/lib/ai-recommendation-handoff.ts`.
- Valid AI handoff tickers must match `^[A-Z0-9._-]{1,16}$` after trim/uppercase.
- Invalid tickers now render a disabled `span._rec-prefill-disabled` with the message `標的代碼異常，未帶入交易室 SIM 預覽。`.
- Valid recommendations still render active `/portfolio?prefill=true&from_rec=...` links with side/entry/stop/target params.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke with mock Recommendation Orchestrator feed:
  - `/ai-recommendations` renders `REC-BAD` invalid ticker as disabled `span`, no `href`, expected aria-label.
  - `/ai-recommendations/REC-BAD` renders disabled detail CTA and no active `from_rec=REC-BAD` link.
  - `/ai-recommendations` and `/ai-recommendations/REC-GOOD` still render active valid links:
    `/portfolio?ticker=2317&prefill=true&from_rec=REC-GOOD&side=buy&entry=123&stop=111&tp=180`.
  - No browser console errors, request failures, or >=400 responses during the smoke.

## Screenshots

- `evidence/w7_paper_sprint/ai-invalid-ticker-cta-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-invalid-ticker-cta-detail-1366x900.png`
- `evidence/w7_paper_sprint/ai-invalid-ticker-cta-good-detail-1366x900.png`

## Notes For Elva / Jason / Bruce

- Elva: the visible handoff copy stays SIM/研究-only and no longer promises a portfolio jump when ticker quality is unsafe.
- Jason: no backend endpoint change requested; this consumes existing Recommendation Orchestrator output defensively.
- Bruce: route protection and production hostname middleware were not touched.
