# Bruce Cycle 3 Verify — PR #399 Lab Snapshot Local Embedded Fallback
**Date**: 2026-05-13 00:40 TST  
**PR**: #399 commit `c0110f8` (feature branch) / `2ce81bc` (squash-merge on main, deployed)  
**Deploy confirm**: GHA run 25747771297 — Deploy to Railway, headSha=`2ce81bc`, completed 2026-05-12T16:26:27Z SUCCESS  
**Railway startedAt**: 2026-05-12T16:35:05Z (9min after deploy — clean boot confirmed)  
**Auth**: Owner role confirmed (qazabc159@gmail.com)

---

## == Bruce Cycle 3 Verify PR #399 ==

```
cont_liq_v36 snapshot:  HTTP_404 / source=null / stale_reason=snapshot_not_found
strategy_002 snapshot:  HTTP_404 / source=null / stale_reason=snapshot_not_found
strategy_003 snapshot:  HTTP_404 / source=null / stale_reason=snapshot_not_found
v47 fields complete:    N/A (snapshot null — cannot evaluate in prod)
equityCurve points:     N/A
sampleTrades entries:   N/A
UI render data:         BLOCKED (API 404 → CSR page falls to hardcoded data)
Verdict: D4_BLOCKED
```

---

## Static Pre-Verify (local codebase c0110f8)

### Embedded JSON field check (3 files)

| Field | cont_liq_v36 | strategy_002 | strategy_003 |
|-------|-------------|-------------|-------------|
| strategyId match | YES | YES | YES |
| v47 keys present (3/3) | YES | YES | YES |
| equityCurve.points count | 0 | 0 | 0 |
| sampleTrades.entries count | 0 | 0 | 0 |
| sampleTrades first entry source='mock_for_demo' | N/A (empty) | N/A (empty) | N/A (empty) |

Note: `equityCurve.points = 0` and `sampleTrades.entries = 0` in ALL 3 embedded JSONs. Even if the API fix worked, these 2 sub-checks from the task spec would FAIL.

### Code path trace

- `LOCAL_SNAPSHOT_DIRS` defined in `lab-strategy-snapshot-fetcher.ts` lines 45-49:
  1. `process.env["LAB_SNAPSHOT_LOCAL_DIR"]` (unset on Railway)
  2. `join(process.cwd(), "data", "lab", "strategy_snapshots")` ← NEW in PR #399
  3. `join(process.cwd(), "lab-strategy-snapshots")` ← OLD path
- `git ls-files apps/api/lab-strategy-snapshots/` = EMPTY (not tracked in git, local-only)
- `git ls-files data/lab/strategy_snapshots/` = 4 files (tracked in git, included in 2ce81bc)
- Railway deploys via `railway up --service api` from monorepo root

---

## Live API Evidence

### Endpoint Probes (all Owner-auth)

| Endpoint | HTTP Status | Body |
|----------|------------|------|
| GET /api/v1/lab/strategy/cont_liq_v36/snapshot | 404 | `{"error":"snapshot_not_found","strategyId":"cont_liq_v36","snapshot":null,"cache_hit":false}` |
| GET /api/v1/lab/strategy/strategy_002/snapshot | 404 | `{"error":"snapshot_not_found","strategyId":"strategy_002","snapshot":null,"cache_hit":false}` |
| GET /api/v1/lab/strategy/strategy_003/snapshot | 404 | `{"error":"snapshot_not_found","strategyId":"strategy_003","snapshot":null,"cache_hit":false}` |

### Audit Log Evidence (action=lab.snapshot_fetched)

Most recent audit entry for cont_liq_v36:
```json
{
  "action": "lab.snapshot_fetched",
  "entityId": "cont_liq_v36",
  "payload": {
    "ok": false,
    "source": null,
    "cache_hit": false,
    "staleReason": "snapshot_not_found"
  },
  "createdAt": "2026-05-12T16:44:42.363Z"
}
```

`source: null` confirms: local fallback returned null — JSON files NOT accessible at runtime on Railway.

---

## Root Cause Analysis

**PR #399 added `data/lab/strategy_snapshots/` at monorepo root as primary local fallback.**

On Railway, `process.cwd()` at API runtime = likely `/app/apps/api` (service runs `node dist/server.js` from apps/api workdir), NOT monorepo root `/app`.

Therefore:
- Path 1: `join(process.cwd(), "data", "lab", "strategy_snapshots")` resolves to `/app/apps/api/data/lab/strategy_snapshots/` — DOES NOT EXIST (data/ is at repo root not inside apps/api)
- Path 2: `join(process.cwd(), "lab-strategy-snapshots")` resolves to `/app/apps/api/lab-strategy-snapshots/` — NOT IN GIT (local-only dir, never committed)

Result: both fallback paths fail → `readLocalJson` returns null → `serveLocalSnapshotFallback` returns null → 404.

**The fix must place the JSON files inside `apps/api/` tree OR use an absolute path that Railway can resolve.**

---

## Task Spec Sub-check Results

| Check | Result | Notes |
|-------|--------|-------|
| cont_liq_v36 snapshot HTTP 200 | FAIL (404) | local_embedded not accessible |
| strategy_002 snapshot HTTP 200 | FAIL (404) | local_embedded not accessible |
| strategy_003 snapshot HTTP 200 | FAIL (404) | local_embedded not accessible |
| source=local_embedded | FAIL (source=null) | fallback never fires |
| snapshot.strategyId match | N/A | snapshot null |
| v47 fields present in prod | N/A | snapshot null |
| equityCurve.points (any) | N/A | snapshot null; also 0 in embedded JSON |
| sampleTrades entries (any) | N/A | snapshot null; also 0 in embedded JSON |
| UI renders real numbers | FAIL | API 404, UI falls to hardcoded data |
| 2.2202 hardcode removed from UI | FAIL | Still in StrategyDetailClient.tsx |

---

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| D4 fix (lab snapshot live) | D4_BLOCKED |
| PR #399 is truly green | NO — deploys without error but fix doesn't work on Railway |
| Can deploy? | Already deployed — but ineffective |
| Can declare live / close? | NO |

---

## Fix Required (Jason lane)

**Option A (recommended)**: Move embedded JSON files INTO `apps/api/src/` or `apps/api/data/` and update `LOCAL_SNAPSHOT_DIRS` path 2 to resolve relative to `import.meta.url` / `fileURLToPath(__dirname)` instead of `process.cwd()`.

**Option B**: Commit the `apps/api/lab-strategy-snapshots/` directory into git (the old path that matched what Railway would find), update the JSON files there to v47 spec.

**Option C**: Add `LAB_SNAPSHOT_LOCAL_DIR=/app/data/lab/strategy_snapshots` as Railway env var (if Railway CWD is indeed `/app`).

Fix owner: Jason.

---

## Secondary Findings (non-blocking for D4 but real)

1. `equityCurve.points = 0` in all 3 embedded JSONs — even post-fix, this sub-check will fail unless Jason populates real equity curve data.
2. `sampleTrades.entries = 0` in all 3 embedded JSONs — task spec expects entries with `source='mock_for_demo'`.
3. `2.2202` hardcoded equity curve value still present in `apps/web/app/lab/three-strategy/[strategyId]/StrategyDetailClient.tsx` — UI not updated to pull live API data.
4. `/lab/strategies` (list endpoint) returns 200 with 3 candidates — that path works.

---

## Stop-line Check

- Token / secrets leak: NONE
- Fake green reporting: NONE (this report is honest 404 not false 200)
- Functional file scope violation: NONE (no functional files modified by Bruce)
