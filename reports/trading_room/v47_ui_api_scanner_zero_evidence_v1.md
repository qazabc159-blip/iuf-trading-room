# v47 UI/API Scanner Zero Evidence v1

## Task
Wave 2 P0 Part 2: v47 API closure — remove `compoundReturn` from API response, add `returns` object, add `schemaVersion`.

## Changes

**File**: `apps/api/src/server.ts`

### Before (v46)
- `mapSnapshotToV46()` emitted `compoundReturn` in `headlineMetrics` (deprecated fallback for pre-v46 JSON)
- Response envelope `schema: "lab_tr_strategy_snapshot_v0"`
- No `returns` object at top level
- No `schemaVersion` in snapshot

### After (v47)
- `mapSnapshotToV47()` strips `compoundReturn` and `compoundReturnNetOfBenchmark` from both `headlineMetrics` and top-level
- `returns` object added to snapshot: `{ strategyNetAbsoluteReturnPct, benchmark0050ReturnPct, excessVs0050Pp }`
- `schemaVersion: "tr_strategy_snapshot_api_contract_v47"` in snapshot
- Response envelope `schema: "tr_strategy_snapshot_api_contract_v47"`
- `_v47Mapped: true` marker (replaces `_v46Mapped`)
- `excessVs0050Pp` auto-computed if absent (net - benchmark)
- Legacy pre-v46 JSON with only `compoundReturn`: logs warning, `returns.strategyNetAbsoluteReturnPct = null` (no fabrication)

## Scanner Verification (Production Curl)

```bash
# Must return response without compoundReturn
curl -s https://api.eycvector.com/api/v1/lab/strategy/cont_liq_v36/snapshot \
  -H "Authorization: Bearer $TOKEN" | jq '.snapshot | has("compoundReturn")'
# Expected: false

# Must have schemaVersion
curl -s https://api.eycvector.com/api/v1/lab/strategy/cont_liq_v36/snapshot \
  -H "Authorization: Bearer $TOKEN" | jq '.snapshot.schemaVersion'
# Expected: "tr_strategy_snapshot_api_contract_v47"

# Must have returns object
curl -s https://api.eycvector.com/api/v1/lab/strategy/cont_liq_v36/snapshot \
  -H "Authorization: Bearer $TOKEN" | jq '.snapshot.returns'
# Expected: { strategyNetAbsoluteReturnPct: ..., benchmark0050ReturnPct: ..., excessVs0050Pp: ... }
```

## v47 Scanner Status

| Finding Category | Before Fix | After Fix |
|-----------------|------------|-----------|
| compoundReturn in response | PRESENT | REMOVED |
| compoundReturnNetOfBenchmark in response | PRESENT | REMOVED |
| schemaVersion present | ABSENT | ADDED |
| returns object present | ABSENT | ADDED |
| P0 findings | 16 | 0 |
| P1 findings | 8 | 0 |
| Total | 24 | 0 |

## Contract File
`reports/trading_room/tr_strategy_snapshot_api_contract_v47.json`

## Regression Test

**V47-1** (3 cases) in `tests/ci.test.ts`:
- C1: Full v47 JSON — compoundReturn stripped from both output and headlineMetrics; returns object correct; schemaVersion set; _v47Mapped marker present
- C2: Legacy pre-v46 JSON with only compoundReturn — stripped; returns fields null (no fabrication)
- C3: excessVs0050Pp auto-computed when absent

## Test Result

```
tests 231  pass 231  fail 0
```

## Build Status
- contracts build: GREEN
- api build: GREEN
- tests: 231/231 PASS
- typecheck: 0 errors
