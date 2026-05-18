# Codex Evidence - AI Feedback SIM State

Date: 2026-05-18
Branch: `fix/web-ai-feedback-sim-state-2026-05-18`
Scope: `/ai-recommendations` feedback and SIM handoff state

## Shipped

- Renamed the AI recommendation `acted` feedback label from `已帶單` to `已帶入 SIM`.
- Added a small client-side feedback snapshot store for the current browser session.
- AI recommendation handoff clicks now immediately mark the recommendation as `已送出：已帶入 SIM`, then upgrade to `已記錄：已帶入 SIM` when the feedback POST succeeds.
- Manual feedback buttons and handoff telemetry now share the same UI state so list/detail pages do not drift.

## Safety

- Frontend-only change under `apps/web/app/ai-recommendations`.
- No API contract change; the payload remains `{ "reaction": "acted" }`.
- No portfolio iframe/vendor layout rewrite.
- No KGI live broker write path, real-order promotion, default live execution, risk/contracts, heatmap data, homepage layout, secrets, or OpenAlice source import.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke used a local mock recommendations API, an owner-session cookie, and Playwright-routed feedback POSTs:
  - `/ai-recommendations` desktop 1366x900 rendered `已帶入 SIM` and saved feedback as `已記錄：已帶入 SIM`.
  - `/ai-recommendations/SMOKE-2330-AI-FEEDBACK` mobile 390x844 rendered the handoff feedback state and persisted `{ "reaction": "acted", "status": "saved" }` in session storage.
  - The forbidden wording `已帶單` was absent.
  - No browser page errors, console errors, failed requests, HTTP >=400 responses, or horizontal overflow were observed.

## Screenshots / Artifacts

- `evidence/w7_paper_sprint/ai-feedback-sim-state-list-saved-1366x900.png`
- `evidence/w7_paper_sprint/ai-feedback-sim-state-detail-handoff-mobile-390x844.png`
- `evidence/w7_paper_sprint/ai-feedback-sim-state-smoke-results.json`

## Known External Blocker

- Railway deploy verification remains blocked by missing `SEED_OWNER_PASSWORD`.
- Latest API deploy run for #663 failed at the verify step after `SEED_OWNER_PASSWORD` was empty; migration/log truth still needs Railway/API confirmation from the backend lane.
