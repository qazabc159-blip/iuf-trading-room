# Codex Evidence - AI Handoff Preview

Date: 2026-05-18
Branch: `fix/web-ai-handoff-preview-2026-05-18`
Scope: `/ai-recommendations -> /portfolio` SIM handoff clarity

## Shipped

- Added a reusable `RecommendationHandoffPreview` component for AI recommendation handoffs.
- The recommendation list card now shows a visible `SIM 帶入預覽` before the `一鍵帶到交易室` CTA.
- The recommendation detail page now shows the same preview before the handoff CTA.
- The preview displays the exact safe URL fields already being handed to `/portfolio`: ticker, side, entry, stop, target, and recommendation id.
- The preview explicitly says `不建立券商委託` before navigation.

## Safety

- Frontend-only change under `apps/web/app/ai-recommendations`.
- No API contract changes.
- No portfolio vendor iframe/layout rewrite.
- No broker/risk/contracts changes.
- No KGI live write path, real-order promotion, default live execution, secrets, homepage, or heatmap data changes.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke used a local mock API and an owner-session cookie:
  - `/ai-recommendations` desktop 1366x900 rendered the preview.
  - `/ai-recommendations/SMOKE-2330-AI-HANDOFF` mobile 390x844 rendered the preview with no horizontal overflow.
  - Handoff href was `/portfolio?ticker=2330&prefill=true&from_rec=SMOKE-2330-AI-HANDOFF&side=buy&entry=1050&stop=1010&tp=1095`.
  - `/portfolio` iframe route showed the existing SIM preview box after navigation.
  - Direct paper-room iframe route rendered `已帶入交易室 SIM 預覽` with no page errors, failed requests, or HTTP >=400 responses.

## Screenshots / Artifacts

- `evidence/w7_paper_sprint/ai-handoff-preview-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-handoff-preview-detail-mobile-390x844.png`
- `evidence/w7_paper_sprint/ai-handoff-preview-portfolio-1366x900.png`
- `evidence/w7_paper_sprint/ai-handoff-preview-paper-room-direct-1366x900.png`
- `evidence/w7_paper_sprint/ai-handoff-preview-smoke-results.json`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
