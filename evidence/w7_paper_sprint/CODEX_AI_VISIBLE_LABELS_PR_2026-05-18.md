# Codex Evidence - AI Visible Labels

Date: 2026-05-18
Branch: `fix/web-ai-visible-labels-2026-05-18`
Scope: `/ai-recommendations` visible copy polish

## Shipped

- Replaced the AI recommendation list panel count `recommendations` with `筆推薦`.
- Replaced visible AI recommendation detail labels:
  - `ENTRY` -> `進場區`
  - `INVALIDATION` -> `失效條件`
  - `POSITION` -> `倉位建議`
  - `QUANT SOURCE` -> `量化來源`
  - `RISKS` -> `風險`
- Replaced the visible `Macro` reason group label with `總經` on list and detail pages.

## Safety

- Frontend-only copy change under `apps/web/app/ai-recommendations`.
- No API contract, recommendation scoring, handoff href, portfolio iframe/vendor layout, broker/risk/contracts, KGI live path, real-order promotion, secrets, homepage, or heatmap data changes.
- SIM-only wording and handoff behavior from PR #657 are unchanged.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke with local mock API and owner-session cookie:
  - `/ai-recommendations` desktop 1366x900 rendered `1 筆推薦`, `總經`, and `SIM 帶入預覽`.
  - `/ai-recommendations/SMOKE-2330-AI-LABELS` mobile 390x844 rendered `進場區`, `失效條件`, `倉位建議`, `量化來源`, `風險`, and `總經`.
  - Forbidden visible residues were not found: `1 recommendations`, `ENTRY`, `INVALIDATION`, `POSITION`, `QUANT SOURCE`, `RISKS`, `Macro`.
  - Page errors, failed requests, HTTP >=400 responses: none.
  - Mobile horizontal overflow: none.

## Screenshots / Artifacts

- `evidence/w7_paper_sprint/ai-visible-labels-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-visible-labels-detail-mobile-390x844.png`
- `evidence/w7_paper_sprint/ai-visible-labels-smoke-results.json`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
