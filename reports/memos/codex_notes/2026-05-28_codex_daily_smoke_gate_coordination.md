# 2026-05-28 Codex Daily Smoke Gate Coordination

## Latest Merged State

- `origin/main` is at `afa38bc` (trading-room search dropdown for all 1938 TW stocks).
- Production API health is 200, current deployment started `2026-05-21T10:51:54.848Z`.
- Daily Production Smoke has failed repeatedly since 2026-05-21, but the latest failure stops in the workflow `skip-check` PowerShell parsing step before the product smoke actually runs.

## Open PRs

- PR #757 remains open and conflicting: AI recommendation v3 7-axis/sourceTrail/migration 0043. This is backend/schema scope and is not touched in this smoke-gate cycle.

## Cross-Team Coordination

- Elva is owning the F-AUTO / KGI SIM rescue lane.
- Elva saved the orphaned KGI SIM position/balance reconstruction work on `wip/kgi-sim-position-reconstruct-rescue-20260528` at commit `e081451`.
- This cycle will not touch `apps/api/src/server.ts`, `tests/ci.test.ts`, `IUF_QUANT_LAB`, KGI broker write paths, or PR #757.

## Blockers / Owners

- Owner: Codex for Daily Production Smoke workflow gate.
- Blocker: workflow uses fragile Windows PowerShell output redirection and non-ASCII alert text in script blocks; it fails before real smoke evidence is produced.
- Follow-up blocker found on PR #761: the self-hosted Windows runner cannot let `actions/setup-python` edit the Windows registry, so W6 and Secret Regression now stay on `iuf-taipei` and resolve the runner's existing `python`/`py` instead of installing Python during CI.
- Follow-up blocker found after merge: `Invoke-ProductionSmoke.ps1` contained non-ASCII dash/box characters that Windows PowerShell 5.1 on the runner decoded incorrectly, causing parse errors before real endpoint checks. The smoke script is now normalized to ASCII.
- Owner: Elva/Bruce for F-AUTO SIM production state verification.

## Chosen Safe Task

Restore the Daily Production Smoke workflow so production QA can actually run again. This is intentionally narrow: workflow robustness only, no product behavior changes, no backend endpoint changes, no UI redesign.
