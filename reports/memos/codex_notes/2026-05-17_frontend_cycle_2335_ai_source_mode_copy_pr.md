# 2026-05-17 Frontend cycle 2335 - AI source mode copy polish

Owner: Codex frontend (`apps/web`)
Scope: `/ai-recommendations` and `/ai-recommendations/[id]` source mode display copy

## Latest merged state

- `origin/main` is at `6485287`:
  - `#628` AI recommendation generated/source timestamp readability.
  - `#626` HeaderDock drag regression QA evidence.
  - `#625` Quant owner E2E QA evidence.
  - `#624` Jason API UTA Phase A BrokerAdapter abstraction.
- Local main worktree was fast-forwarded and is clean.

## Elva / Jason / Bruce progress check

- Elva's explicitly referenced note `reports/codex_notes/2026-05-17_elva_to_codex_unblock_and_priorities.md` is not present on current `origin/main`; `reports/codex_notes/` itself is absent in this worktree.
- Visible Jason progress:
  - `#629` OpenAlice Brain Phase A is open, API-owned, mergeable, with security checks green and `validate` still queued at the time of this note.
  - `#627` OpenAlice EventLog Phase A is closed without merge; it had included `apps/web/app/globals.css` churn and was not a frontend-owned safe target.
- Bruce/QA evidence currently covers AI-to-Portfolio owner E2E, Quant owner E2E, HeaderDock owner checks, and HeaderDock drag regression.

## Blocked items and owners

- True production Owner-session QA still needs an authenticated production Owner browser context.
  - Owner: Yang / Elva if that validation is required.
- Backend Recommendation/Brain/EventLog endpoint semantics, persistence, and merge conflicts remain backend-owned.
  - Owner: Jason.

## Chosen frontend-safe task

Polish the AI recommendation page source mode label so user-facing panel subtitles no longer expose raw engineer strings like `ORCHESTRATOR`, `MOCK FEED`, or `SYNCING`.

This is a bounded `apps/web` UI copy task that preserves backend behavior, recommendation contracts, feedback wiring, portfolio handoff behavior, and the vendor tactical homepage layout.
