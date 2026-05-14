# Frontend Codex overnight sync — 2026-05-15 01:35 TST

Owner lane: apps/web frontend.

## Current merged state

- #481 merged: homepage tactical sidebar aligned to frozen 6-entry IA.
- #482 merged: header dock draggable with localStorage position memory.
- #483 merged: P0 companies list perf fix from backend lane.
- #484 merged: company coverage section visual polish.
- #491 merged: `/ai-recommendations` wired to Recommendation Orchestrator v1 client surface.
- #493 merged: `/quant-strategies` list/detail with SIM-only guardrails.
- #494 merged: header bell drawer wired read-only to existing alerts engine.

## Coordination notes

- No open PRs at this checkpoint.
- Frontend branch state is clean on latest `origin/main`.
- Day 6 notification drawer intentionally uses existing `/api/v1/alerts` via `getAlerts()` because the formal `/api/v1/notifications` endpoint is not confirmed merged yet.
- AI recommendation page still needs Owner-session production audit after backend data/auth are available.
- Quant strategy page is frontend-ready, but production backend endpoint/subscription integration remains a Jason-owned dependency.
- Do not create frontend fake data to cover backend gaps.

## Next safe cycle candidates

1. Run a targeted production/local route sweep on `/`, `/ai-recommendations`, `/quant-strategies`, `/quant-strategies/:id`, `/alerts`, `/briefs`, `/companies`.
2. If browser audit finds visible mojibake, overlap, or fake wording in apps/web, patch narrowly.
3. If no frontend-visible issue is found, leave a status-only note instead of forcing code churn.

## Hardlines reaffirmed

- No KGI live broker write.
- No default `executionMode='live'`.
- No PAPER_LIVE promotion.
- No secrets or credential exposure.
- No IUF_QUANT_LAB or IUF_SHARED_CONTRACTS edits.
- No apps/api broker/risk/contracts edits.
