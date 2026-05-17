# 2026-05-18 Frontend cycle 0717 - AI visible labels

Owner: Codex frontend (`apps/web`)
Scope: `/ai-recommendations` visible label polish

## Latest merged state

- `origin/main` is at `9ebf3b0` (`fix(web): preview ai portfolio handoff`, PR #657).
- Recent frontend fixes:
  - `#657` added visible SIM-only handoff previews before AI recommendation portfolio CTAs.
  - `#656` compacted all-empty company full-profile panels.
  - `#655` added the company detail sidebar rail.
  - `#654` clarified company industry graph fetch-error wording.
  - `#653` surfaced My-TW-Coverage panels in the company detail main area.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest `main` validate for `9ebf3b0` is green.
- No Elva/Jason/Jim/Bruce PR is currently waiting on frontend review from this worktree.
- Elva's explicitly referenced `reports/codex_notes/2026-05-17_elva_to_codex_unblock_and_priorities.md` remains absent in this worktree; current merged PRs and `reports/memos/codex_notes/` are the available source of truth.

## Blocked items and owners

- Production deploy verification remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- Heatmap universe/KGI fallback semantics remain Elva/Jason/API-owned; this cycle does not touch heatmap data code.

## Chosen frontend-safe task

Remove remaining English/template residue from AI recommendation visible labels:

- Change the list panel count from `recommendations` to Chinese copy.
- Change detail-card labels `ENTRY`, `INVALIDATION`, `POSITION`, `QUANT SOURCE`, and `RISKS` to clear Chinese labels.
- Change the visible macro reason group from `Macro` to `總經`.
- Preserve behavior and all SIM-only safety semantics; no backend, portfolio iframe, broker/risk/contracts, heatmap, homepage, or secret changes.
