# CODEX_CI_CACHE_SETUP_FIX_2026-05-16

## Scope
- Branch: `fix/ci-cache-setup-2026-05-16`
- File: `.github/workflows/ci.yml`
- Purpose: unblock CI runs such as #550 by removing brittle setup cache inputs.

## Root Cause
- `validate` failed in `actions/setup-node@v5` because `cache: pnpm` was enabled before pnpm/Corepack activation.
- Python audit jobs passed their audit commands but failed during setup-python post cleanup because `cache: pip` pointed at a missing pip cache directory.

## Change
- Removed `cache: 'pnpm'` from Node setup and explicitly set `package-manager-cache: false` so `actions/setup-node@v5` does not auto-cache pnpm before Corepack activation.
- Removed `cache: 'pip'` from both Python setup steps.
- Kept Corepack activation and pnpm install steps unchanged.

## Verification
- `git diff --check origin/main..HEAD` PASS.
- YAML parsed successfully with Python `yaml.safe_load`.
- Confirmed `.github/workflows/ci.yml` no longer contains `cache: 'pnpm'` or `cache: 'pip'`.
- First #551 run after removing explicit cache inputs showed Python audit jobs PASS; validate still failed because `actions/setup-node@v5` auto-enabled package manager cache from `packageManager`. Added `package-manager-cache: false` and reran verification.

## Follow-up
- After this workflow PR merges, rerun #550 checks and merge #550 only when green.
