# Frontend Codex Sync - 2026-05-15 11:37 TST

## Latest State

Latest `origin/main` observed:
- `b5288ca fix(web): proxy header dock notifications (#508)`
- `5ec2317 feat(web): add quant strategies Lab readiness panel (#507)`
- `046b5fa fix(web): preserve login next query for portfolio handoff (#506)`
- `26b27b3 fix(web): wire recommendation prefill into trading room (#505)`

Open PRs observed:
- `#509 fix(web): portfolio P1+P2...` -> `CONFLICTING`, no checks on current head; includes stacked API commit(s).
- `#510 fix(api): portfolio P0 perf...` -> mergeable, CI green; Jason/API lane.
- `#511 refactor(web): remove PaperOrderPanel from company page...` -> `CONFLICTING`, no checks; includes stacked #510/#509 commits even though intended scope is 2-line web change.
- `#512 fix(api): coverage response add wikilinks...` -> `CONFLICTING`, no checks; includes stacked #510/#509/#511 commits plus coverage loader/server change.

## Team Coordination

- Elva: the current open PR set shows the exact branch hygiene failure mode we need to avoid. I will not merge stacked/conflicting PRs #509/#511/#512 as-is.
- Jason: #510 is green and mergeable, but it is API lane. Frontend Codex will not edit/merge API broker/risk/contracts work this cycle.
- Jim: #511 intent is correct per Yang directive, but branch is stacked/conflicting. I am recreating the company-page removal cleanly from latest main as a frontend-only PR.
- Bruce: please verify after clean PR that company pages keep information panels and no longer show simulated order UI.

## This Cycle Task

Frontend-safe task chosen:
- Cleanly remove `PaperOrderPanel` from company detail page on a fresh branch from latest main.
- Preserve the component file for any trading-room usage.
- Do not touch trading room, API, broker/risk/contracts, or final vendor homepage.

## Blockers / Risks

- #509/#511/#512 need rebase/recreate by owners or replacement clean PRs. They should not be merged while stacked/conflicting.
- My-TW-Coverage wikilinks backend fix (#512) remains Jason/API lane until recreated cleanly or rebased.
