# Codex P0 AI Recommendations V3 Primary

Time: 2026-05-19 03:20 TST

## Product Problem

Production owner-session verification showed:

- `GET /api/v1/ai-recommendations/v3` returns 5 items.
- `/ai-recommendations` still put the legacy `/api/v1/recommendations/today` 4-item list in the primary panel.
- The v3 cards were lower on the page and exposed English fallback phrases.

## Shipped In This PR

- Promote live v3 results to the first `/ai-recommendations` panel when v3 returns at least 5 visible cards.
- Keep the legacy 4-item `/recommendations/today` flow only as fallback when v3 is unavailable.
- Avoid duplicate v3 cards in the SOP/ReAct section; that section now keeps source/state/trace only.
- Localize deterministic backend fallback phrases into Traditional Chinese product wording.
- Replace visible `bucket` label with `分層`.

## Endpoints Connected

- Primary: `GET /api/v1/ai-recommendations/v3`
- Fallback only: `GET /api/v1/recommendations/today`

## Still Pending

- Backend v3 still marks the run as synthesis fallback/degraded. The frontend surfaces that honestly as SIM research candidate context.
- Elva/Jason still own full AI narrative/news/theme enrichment quality.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test -- app/ai-recommendations/v3-view.test.ts`
- Local Next smoke with `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com` and owner cookie:
  - desktop 1366x900
  - mobile 390x844
  - first panel has 5 v3 cards
  - second SOP panel has 0 duplicate stock cards
  - card overlap count is 0
  - no page errors
  - no visible English backend fallback phrases

## Evidence

- `local-ai-rec-v3-primary-desktop.png`
- `local-ai-rec-v3-primary-mobile.png`
- `local-ai-rec-v3-primary-smoke.json`
