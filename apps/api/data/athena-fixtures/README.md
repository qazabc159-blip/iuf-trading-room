# Athena Quant Candidate Signal Fixtures

This directory bundles Athena (Quant Lab) candidate signal fixtures into IUF Trading Room repo so Railway deploy can read them at runtime (Railway has no access to sibling `IUF_QUANT_LAB` repo).

## Source

Authored by: Athena (Quant Lab) — `IUF_QUANT_LAB/research/fixtures/`
License: internal (IUF) — Lab + TR teams share

## Update cadence

Daily after market close (post 14:00 TST), or per Lab forward observation checkpoint.

## Sync command

```
# From repo root
cp ../IUF_QUANT_LAB/research/fixtures/quant_candidate_signal_cont_liq_v36_*.json apps/api/data/athena-fixtures/
```

## Schema

See `packages/contracts/src/recommendation.ts` for `QuantCandidateSignal` type.

## Path resolution priority

1. `ATHENA_FIXTURE_PATH` env var (Railway override)
2. `apps/api/data/athena-fixtures/` (bundled)
3. Sibling `../IUF_QUANT_LAB/research/fixtures/` (Windows dev)
4. `IUF_QUANT_LAB_PATH` env var
