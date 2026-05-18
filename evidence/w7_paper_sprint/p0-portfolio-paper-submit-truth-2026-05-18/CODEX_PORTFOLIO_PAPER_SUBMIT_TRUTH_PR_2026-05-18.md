# CODEX Portfolio Paper Submit Truth PR — 2026-05-18

## Scope
Fix `/portfolio` final-v031 trading room Paper submit semantics.

## Production bug found before fix
Owner-session production QA on `https://app.eycvector.com/portfolio?symbol=2603` showed that clicking the visible Paper submit button triggered both:

- `POST /api/v1/kgi/sim/order` → 409
- `POST /api/v1/paper/submit` → 422

That was a P0 product semantics bug: Paper Submit must only write the platform paper ledger. KGI SIM must be a separate explicit lane, and Real remains locked.

## Shipped in this PR
- Changed final-v031 Paper submit to call only `/api/ui-final-v031-paper/submit` after paper preview.
- Removed KGI SIM fallback from the visible Paper button.
- Changed Paper handoff copy from `SIM Preview` to `Paper Preview` / `紙上單預覽`.
- Preserved the real-order lock copy.
- Normalized paper risk-block responses to HTTP 200 on the same-origin helper route so the UI can show official blocked reasons instead of a generic failure.
- Added body preservation to `PaperOrderApiError` so the helper route can surface backend risk details.
- Mapped common risk codes to Chinese operator copy (`非交易時段`, `單筆風控超限`, etc.).

## Endpoints connected
- Preview: `/api/v1/paper/preview`
- Submit helper: `/api/ui-final-v031-paper/submit`
- Backend submit behind helper: `/api/v1/paper/submit`

## Explicitly not touched
- No KGI live broker write path.
- No real-order promotion.
- No backend broker/risk/contracts changes.
- No homepage/layout rewrite.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- Local browser smoke on `http://127.0.0.1:3125/portfolio?symbol=2603` with owner cookie and prod API base:
  - Page loaded 200.
  - Paper mode and Real lock visible.
  - Paper submit posts only paper preview + same-origin paper submit.
  - `postedKgiSimOrder=false`.
  - SIM preview copy removed from paper panel.
  - Risk blocked state appears in Chinese: `非交易時段、單筆風控超限`.

## Evidence
- `evidence/w7_paper_sprint/p0-portfolio-prod-scan-2026-05-18/prod-portfolio-paper-submit-clicked-2603.json`
- `evidence/w7_paper_sprint/p0-portfolio-paper-submit-truth-2026-05-18/local-portfolio-paper-submit-clicked-2603-final.json`
- `evidence/w7_paper_sprint/p0-portfolio-paper-submit-truth-2026-05-18/local-portfolio-paper-submit-clicked-2603-final.png`

## Remaining blockers / owners
- KGI quote bid/ask and ticks still return 422/503 for some symbols/off-hours and produce browser resource errors. UI already degrades to non-trading-hours copy. Owner: Jason/Bruce KGI gateway/session lane.
