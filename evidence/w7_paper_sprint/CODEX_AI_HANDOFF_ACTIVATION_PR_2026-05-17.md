# CODEX AI Handoff Activation Telemetry PR - 2026-05-17

## Scope

- Branch: `fix/web-ai-handoff-activation-telemetry-2026-05-17`
- Frontend-owned surface: `apps/web/app/ai-recommendations/RecommendationHandoffLink.tsx`
- Task: keep AI recommendation `acted` telemetry when the portfolio handoff is opened by a normal click, modified click, or middle-click/new-tab activation.
- Out of scope: backend broker/risk/contracts, KGI live broker write paths, homepage layout.

## Change

- Removed the modifier-key early return from the primary click handler so Ctrl/Cmd/Shift/Alt activations still record `acted`.
- Added an `onAuxClick` handler for middle-click activation.
- Kept telemetry fire-and-forget through the existing same-origin feedback route; handoff navigation remains non-blocking.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke on `http://127.0.0.1:3114/ai-recommendations` with mock API on `127.0.0.1:3113` passed:
  - normal primary click: feedback count `0 -> 1`
  - Ctrl modified primary click: feedback count `1 -> 2`
  - middle-click activation: feedback count `2 -> 3`
  - all feedback bodies were `{ "reaction": "acted" }`
  - browser console errors: none
- Screenshot: `evidence/w7_paper_sprint/ai-handoff-activation-telemetry-1366x900.png`
- `git diff --check` passed, with only the expected Windows LF-to-CRLF warning.

## Safety

- No paper/live promotion wording added.
- No live execution-mode default added.
- No KGI live broker write path touched.
- No secrets, tokens, database connection URL, KGI password, or restricted external source introduced.
- Did not touch `apps/api`, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.
