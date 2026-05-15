# CODEX AI Detail Header Label Fix — 2026-05-15

## Scope
- Fixed `/ai-recommendations/[id]` header label after production QA review.
- The detail page used `PageFrame code="12-D"`, which maps to AI daily brief detail wording.
- Changed both success and error states to `PageFrame code="AI-D"` so the route presents as AI recommendations.

## Safety
- Frontend-only visual/routing-label fix.
- No broker, risk, contracts, KGI, or live-order paths touched.
- Avoided open PR `#544` paper trading room vendor HTML.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` → PASS.
- Browser smoke with local fake Recommendation API:
  - `/ai-recommendations/rec-2330` loads.
  - `.page-code` is `AI-D`.
  - Body no longer contains `每日簡報`.
  - No hard console errors.
- Screenshot: `evidence/w7_paper_sprint/CODEX_AI_DETAIL_HEADER_LABEL_2026-05-15.png`.
