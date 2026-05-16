# 2026-05-16 10:24 Frontend Codex sync

## Latest merged state
- `origin/main` remains `6728473 fix(web): surface quant subscribe readiness warnings (#548)`.
- #548 is merged; frontend train is no longer blocked by that PR.

## Open PRs
- #550 `fix(web): proxy company coverage endpoints` is open and locally verified, but CI is `UNSTABLE`.
- #549 `fix(api): market-data/overview perf` remains Jason-owned API lane.

## Blocked / owners
- #550 is blocked by GitHub workflow setup/cache failures, not by the company coverage patch:
  - `validate` fails in `actions/setup-node@v5` because the workflow asks for `cache: pnpm` before pnpm is available.
  - `W6 No-Real-Order Audit` and `Secret Regression Check (A2)` pass their audit steps but fail in `Post Setup Python` because `cache: pip` points at a missing pip cache folder.
- Owner: frontend/release lane can fix `.github/workflows/ci.yml` in a separate single-purpose workflow PR.

## This cycle task
- Create a single-purpose CI workflow PR that removes brittle Node/Python cache inputs from the CI setup path.
- Do not mix this workflow fix into #550.
- After workflow fix merges, rerun #550 checks.
