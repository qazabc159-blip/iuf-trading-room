# PR #461 Step 0c — Route B: skip-on-missing secrets

**Date**: 2026-05-14 14:25 TST  
**Branch**: fix/migration-0031-unique-constraint-dedup-2026-05-14  
**Author**: Jason

## Change

`.github/workflows/deploy.yml` — "Verify migrations applied (api only)" step:

**Before** (hard-fail on missing secrets):
```
if [ -z "${SEED_OWNER_EMAIL:-}" ] || [ -z "${SEED_OWNER_PASSWORD:-}" ]; then
  echo "::error::SEED_OWNER_EMAIL or SEED_OWNER_PASSWORD GitHub secret is not set..."
  exit 1
fi
```

**After** (Route B — warning + skip):
```
if [ -z "${SEED_OWNER_EMAIL:-}" ] || [ -z "${SEED_OWNER_PASSWORD:-}" ]; then
  echo "::warning::SEED_OWNER_EMAIL or SEED_OWNER_PASSWORD secret not set — skipping migration verify (Route B)"
  exit 0
fi
```

## Behaviour Matrix

| Secrets set? | Verify result | Outcome |
|---|---|---|
| No | — | ::warning:: + skip (exit 0) |
| Yes | PASS | ::notice:: count OK (exit 0) |
| Yes | FAIL | ::error:: blocking (exit 1) |

## Gate Preserved

`EXPECTED_MIGRATION_COUNT=31` hard check remains intact — only activates when secrets are present.

## Files Modified

- `.github/workflows/deploy.yml` — missing-secret branch: `exit 1` → `::warning:: + exit 0`; comment updated
