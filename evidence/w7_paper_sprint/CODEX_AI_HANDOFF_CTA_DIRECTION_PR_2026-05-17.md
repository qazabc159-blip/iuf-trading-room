# CODEX AI Handoff CTA Direction PR Evidence - 2026-05-17

Branch: `fix/web-ai-handoff-cta-direction-2026-05-17`

Task:
- Polish AI recommendation handoff CTA copy so the list/detail surfaces visibly show the direction carried into the SIM handoff.
- Display `買進`, `賣出`, or `中性` on the CTA and include the same direction in the link title/aria label.
- Keep the existing #592 handoff behavior: `偏多 -> side=buy`, `偏空 -> side=sell`, `中性 -> no forced side`.

Changed surface:
- `apps/web/app/ai-recommendations/RecommendationHandoffLink.tsx`
- `apps/web/app/ai-recommendations/page.tsx`
- `apps/web/app/ai-recommendations/[id]/page.tsx`

Verification:
- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- `git diff --check` passed.
- Code hardline/secret scan over touched frontend code and cycle note found no matches.
- Browser smoke with local recommendation API fixture passed:
  - `/ai-recommendations`: `REC-BEAR` CTA badge `賣出`, title/aria contained `方向 賣出`, href preserved `side=sell`.
  - `/ai-recommendations`: `REC-BULL` CTA badge `買進`, href preserved `side=buy`.
  - `/ai-recommendations`: `REC-NEUTRAL` CTA badge `中性`, href did not force `side`.
  - `/ai-recommendations/REC-BEAR` at 390x844: detail CTA badge `賣出`, title contained `方向 賣出`, CTA stayed within mobile width.
  - No browser console errors were observed.

Screenshots:
- `evidence/w7_paper_sprint/ai-handoff-cta-direction-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-handoff-cta-direction-detail-mobile-390x844.png`

Safety:
- Frontend-only `apps/web` change.
- No KGI live broker write path changed.
- No `executionMode='live'` or `PAPER_LIVE` promotion added.
- No secrets or tokens added.
- No homepage/vendor tactical layout rewrite.
