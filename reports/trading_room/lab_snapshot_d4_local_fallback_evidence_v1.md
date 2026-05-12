# Lab Snapshot D4 Local Fallback — Evidence v1

**Date**: 2026-05-08  
**PR branch**: `feat/api-lab-snapshot-local-embedded-fallback-2026-05-13`  
**PR title**: `feat(api): Lab snapshot local embedded fallback (D4 final fix)`

---

## Root Cause

`GET /api/v1/lab/strategy/cont_liq_v36/snapshot` → 404 `snapshot_not_found`

GitHub raw URL `https://raw.githubusercontent.com/qazabc159/IUF_QUANT_LAB/main/reports/trading_room/strategy_snapshots/cont_liq_v36_snapshot_v0.json` returns 404 because `qazabc159/IUF_QUANT_LAB` is a private repo.

---

## Fix Applied

### Step 1: Snapshot JSON files copied to TR repo

Path: `data/lab/strategy_snapshots/` (new directory)

Files committed:
- `cont_liq_v36_snapshot_v0.json` — real Lab data (BOM stripped, valid UTF-8)
- `strategy_002_snapshot_v0.json` — real Lab data (BOM stripped)
- `strategy_003_snapshot_v0.json` — real Lab data (BOM stripped)
- `_index.json` — strategy index (BOM stripped)

Source: `IUF_QUANT_LAB/reports/trading_room/strategy_snapshots/` (exact copies, no modification)

### Step 2: Fetcher updated

`apps/api/src/lab-strategy-snapshot-fetcher.ts`:

1. `LOCAL_SNAPSHOT_DIRS` now includes `join(process.cwd(), "data", "lab", "strategy_snapshots")` as primary local path (before legacy fallback dirs)
2. New exported type `LabSnapshotSource = "github" | "local_embedded" | "stale_cache"`
3. `LabSnapshotFetchResult` type now includes `source: LabSnapshotSource` on both ok/fail branches
4. `serveLocalSnapshotFallback()` returns `source: "local_embedded"`
5. All other return paths tagged: github fetch = `"github"`, stale cache = `"stale_cache"`
6. `writeSnapshotAudit` accepts optional `source` param; included in payload

### Step 3: Server endpoint updated

`apps/api/src/server.ts` — `GET /api/v1/lab/strategy/:strategyId/snapshot`:

All response paths now include `source` field from the fetch result.

---

## Priority Order (fallback chain)

1. **In-memory cache** (within 30s TTL) — `source: "github"` (or whatever was cached)
2. **GitHub raw fetch** (live) — `source: "github"`
3. **Local embedded** (`data/lab/strategy_snapshots/`) — `source: "local_embedded"`
4. **Stale cache** (if cached but expired/failed) — `source: "stale_cache"`
5. **Error** (404 / 503) — `source` reflects last attempt

---

## Test Results

Unit tests (`apps/api/src/__tests__/lab-strategy-snapshot.test.ts`):

```
✔ SS1: fetchStrategySnapshot happy path - ok=true, source=github
✔ SS2: ALLOWED_STRATEGY_IDS guard
✔ SS3: cache hit within TTL
✔ SS4: circuit breaker -- local embedded fallback served (source=local_embedded)
✔ SS5: fetch timeout -- local embedded fallback served (source=local_embedded)
✔ SS6: HTTP 503 -- local embedded fallback served (source=local_embedded)
✔ SS7: fetchStrategyIndex returns strategies array
✔ SS8: cache_hit + source present in all paths
✔ SS9: GitHub 404 -- source=local_embedded, real Lab JSON fields present

9/9 PASS
```

contracts build: GREEN  
api build: GREEN  
ci.test.ts: FAIL (pre-existing ERR_REQUIRE_CYCLE_MODULE on main, not my change)

---

## Production Verify Command

After deploy:

```bash
# Bearer token required (Owner/Admin/Analyst role)
curl -s -H "Authorization: Bearer <token>" \
  https://api.eycvector.com/api/v1/lab/strategy/cont_liq_v36/snapshot \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('status:', 'ok' if d.get('snapshot') else 'FAIL'); print('source:', d.get('source')); print('schema:', d.get('schema'))"
```

Expected output:
```
status: ok
source: local_embedded
schema: tr_strategy_snapshot_api_contract_v47
```

---

## Note for Athena

Once `qazabc159/IUF_QUANT_LAB` is made public or Lab pushes to a public endpoint, the code will prefer GitHub (live data) over the embedded fallback. No code change needed — fallback is automatic. To update embedded data, copy new snapshots to `data/lab/strategy_snapshots/` and commit.

---

## Files Changed

| File | Type |
|------|------|
| `data/lab/strategy_snapshots/cont_liq_v36_snapshot_v0.json` | NEW (real Lab data) |
| `data/lab/strategy_snapshots/strategy_002_snapshot_v0.json` | NEW (real Lab data) |
| `data/lab/strategy_snapshots/strategy_003_snapshot_v0.json` | NEW (real Lab data) |
| `data/lab/strategy_snapshots/_index.json` | NEW (real Lab data) |
| `apps/api/src/lab-strategy-snapshot-fetcher.ts` | UPDATED (LOCAL_SNAPSHOT_DIRS + source type) |
| `apps/api/src/server.ts` | UPDATED (source field in response) |
| `apps/api/src/__tests__/lab-strategy-snapshot.test.ts` | UPDATED (SS4/SS5/SS6 + SS9 new) |

**Lane boundary maintained**: no broker / risk / migration / web files touched.
