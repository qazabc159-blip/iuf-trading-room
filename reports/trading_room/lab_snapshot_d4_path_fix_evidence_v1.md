# Lab Snapshot D4 Path Fix Evidence

**PR**: #400 `fix/api-lab-snapshot-path-resolution-plus-full-json-2026-05-13`
**Date**: 2026-05-13 (TST)
**Commit**: 2eba9b0

---

## Bug 1: Path Resolution Fix

**Root Cause**: `LOCAL_SNAPSHOT_DIRS` used `join(process.cwd(), "data", "lab", "strategy_snapshots")`.
On Railway, `node` is started via `pnpm --filter @iuf-trading-room/api start` → `process.cwd() = /app/apps/api`.
The JSON files in `data/lab/strategy_snapshots/` are at monorepo root `/app/data/...`, which is NOT reachable
from `/app/apps/api/data/...`. Result: `ENOENT` → local fallback returns null → endpoint returns 404.

**Fix Applied**:
1. Added `fileURLToPath` import (`node:url`)
2. New `_fileDir = fileURLToPath(new URL(".", import.meta.url))` — resolves to compiled file's directory
3. Updated `LOCAL_SNAPSHOT_DIRS` with 4 entries (priority order):
   - `env.LAB_SNAPSHOT_LOCAL_DIR` (explicit override)
   - Option A primary: `join(_fileDir, "../..", "data/lab/strategy_snapshots")` → `apps/api/data/lab/strategy_snapshots/`
   - Option A fallback: `join(_fileDir, "../../../..", "data/lab/strategy_snapshots")` → monorepo root `data/`
   - Option B: `join(process.cwd(), "data/lab/strategy_snapshots")` → works when CWD = `apps/api`

**Why Option A primary works on Railway**:
- Compiled file: `/app/apps/api/dist/lab-strategy-snapshot-fetcher.js`
- `_fileDir` = `/app/apps/api/dist/`
- `join(_fileDir, "../..", "data/lab/strategy_snapshots")` = `/app/apps/api/data/lab/strategy_snapshots/`
- ✓ This is where the new JSON files are placed

---

## Bug 2: JSON Data Content

**Root Cause**: `apps/api/data/lab/strategy_snapshots/` did not exist before this PR.
The existing `data/lab/strategy_snapshots/` (monorepo root) was already correct but unreachable due to Bug 1.

**Fix Applied**: Created `apps/api/data/lab/strategy_snapshots/` with 4 lab JSON files.
Source: `IUF_QUANT_LAB/reports/trading_room/strategy_snapshots/` (BOM-stripped UTF-8).

| File | equityCurve.points | sampleTrades.entries | Identical to lab source |
|---|---|---|---|
| cont_liq_v36_snapshot_v0.json | 13 | 8 | YES |
| strategy_002_snapshot_v0.json | 42 | 8 | YES |
| strategy_003_snapshot_v0.json | 59 | 8 | YES |
| _index.json | N/A | N/A | YES |

---

## Build & Test Results (local)

```
pnpm run build:api: 5/5 successful, 0 errors
pnpm test: 247/247 PASS (includes SS1-SS9 snapshot tests)
```

---

## Production Verify (pending deploy)

After PR #400 merges and deploys, Bruce to verify:

```bash
# Auth token required (Owner credentials)
TOKEN=$(curl -s -X POST https://api.eycvector.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"OWNER_EMAIL","password":"OWNER_PASSWORD"}' | jq -r '.token')

# Strategy 1: cont_liq_v36
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.eycvector.com/api/v1/lab/strategy/cont_liq_v36/snapshot" | \
  jq '{ok:.ok, source:.source, equityPoints:(.snapshot.equityCurve.points|length), sampleEntries:(.snapshot.sampleTrades.entries|length)}'

# Expected: {"ok":true,"source":"local_embedded","equityPoints":13,"sampleEntries":8}

# Strategy 2: strategy_002
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.eycvector.com/api/v1/lab/strategy/strategy_002/snapshot" | \
  jq '{ok:.ok, source:.source, equityPoints:(.snapshot.equityCurve.points|length), sampleEntries:(.snapshot.sampleTrades.entries|length)}'

# Expected: {"ok":true,"source":"local_embedded","equityPoints":42,"sampleEntries":8}

# Strategy 3: strategy_003
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.eycvector.com/api/v1/lab/strategy/strategy_003/snapshot" | \
  jq '{ok:.ok, source:.source, equityPoints:(.snapshot.equityCurve.points|length), sampleEntries:(.snapshot.sampleTrades.entries|length)}'

# Expected: {"ok":true,"source":"local_embedded","equityPoints":59,"sampleEntries":8}
```

**Stop-line**: All 3 strategies must return `ok=true, source=local_embedded, equityPoints>=13, sampleEntries=8`.

---

## Files Changed

- `apps/api/src/lab-strategy-snapshot-fetcher.ts` — fileURLToPath + updated LOCAL_SNAPSHOT_DIRS
- `apps/api/data/lab/strategy_snapshots/_index.json` (new)
- `apps/api/data/lab/strategy_snapshots/cont_liq_v36_snapshot_v0.json` (new)
- `apps/api/data/lab/strategy_snapshots/strategy_002_snapshot_v0.json` (new)
- `apps/api/data/lab/strategy_snapshots/strategy_003_snapshot_v0.json` (new)

## Lane Boundary

- No broker / risk / migration / page.tsx / globals.css modified
- No fake data — all JSON sourced from IUF_QUANT_LAB lab repo
- Only `lab-strategy-snapshot-fetcher.ts` modified (strategy lane)
