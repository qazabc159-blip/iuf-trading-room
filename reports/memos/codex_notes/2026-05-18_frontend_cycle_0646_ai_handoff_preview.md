# 2026-05-18 Frontend cycle 0646 - AI handoff preview

Owner: Codex frontend (`apps/web`)
Scope: `/ai-recommendations -> /portfolio` handoff clarity

## Latest merged state

- `origin/main` is at `3a0159d` (`fix(web): compact empty full profile data`, PR #656).
- Recent frontend fixes:
  - `#656` compacted all-empty company full-profile panels.
  - `#655` added the company detail sidebar rail.
  - `#654` clarified company industry graph fetch-error wording.
  - `#653` surfaced My-TW-Coverage knowledge panels in the company detail main area.
  - `#651` localized AI recommendation quality/source labels.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest `main` validate for `3a0159d` is green.
- Elva's explicitly referenced `reports/codex_notes/2026-05-17_elva_to_codex_unblock_and_priorities.md` is not present in this worktree; recent merged PRs and `reports/memos/codex_notes/` remain the available source of truth.
- No Elva/Jason/Jim/Bruce PR is currently waiting on frontend review from this worktree.

## Blocked items and owners

- Production deploy verification remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- Heatmap universe/KGI fallback semantics remain Elva/Jason/API-owned; this cycle does not touch heatmap data code.

## Chosen frontend-safe task

Improve AI recommendation handoff clarity before `/portfolio` navigation:

- Show a compact SIM-only handoff preview near the CTA on both recommendation list cards and detail pages.
- Preview the exact safe fields already encoded into the handoff URL: ticker, side, entry, stop, target, and recommendation id.
- Keep the "no broker order" safety wording visible before navigation.
- Do not change API contracts, portfolio iframe/vendor layout, broker/risk/contracts, real-order paths, homepage, or heatmap data behavior.
