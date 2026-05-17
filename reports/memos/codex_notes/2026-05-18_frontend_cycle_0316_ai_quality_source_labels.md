# 2026-05-18 Frontend cycle 0316 - AI quality/source labels

Owner: Codex frontend (`apps/web`)

## Latest merged state

- `origin/main` is at `664e720` (`fix(web): harden coverage panels for partial data`, PR #650).
- Recent frontend/productization work:
  - `#650` hardened company detail My-TW-Coverage panels against partial payloads.
  - `#649` added company graph deeplink search and detail CTA.
  - `#648` localized market heatmap industry labels.
  - `#643` fixed the company page left-column blank gap.
  - `#635` improved AI recommendation source mode copy.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- PR #650 and its post-merge main validate are green.
- Latest deploy attempts remain blocked by missing `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` in GitHub Actions.
- Elva's explicitly referenced `reports/codex_notes/2026-05-17_elva_to_codex_unblock_and_priorities.md` is still not present in this worktree; recent merged PRs and `reports/memos/codex_notes/` remain the available source of truth.

## Blocked items and owners

- Production deploy verification: Jason / repo admin must fix owner seed secrets or provide an approved non-secret verification path.
- Heatmap stock universe and KGI/TWSE fallback semantics remain Elva/Jason/API-owned.
- Frontend can safely continue AI recommendation readability and acceptance-gate polish.

## Chosen frontend-safe task

Remove English/template residue from AI recommendation data-quality and source-trail labels:

- List cards: replace `Penalty` with `信心折減`.
- List cards: replace `sourceTrail` summary label with `資料來源`.
- Detail page: replace `SOURCE TRAIL` heading with `資料來源`.
- Keep behavior unchanged: no backend changes, no handoff path promotion, no live-order wording, no homepage layout changes.
