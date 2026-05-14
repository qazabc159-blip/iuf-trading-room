# Jason P1 Fix Evidence — 2026-05-14 22:35 TST

Branch: `fix/taiex-label-lab-pct-brief-backfill-2026-05-14`
Author: Jason (backend-strategy)

---

## P1-A: TAIEX taiexDisplayLabel field added

**Root cause**: `/api/v1/market/overview/twse` returned `sourceState: "lkg"` or `"live"` but no human-readable label. Frontend had no way to distinguish "今日收盤" vs "上日收盤" from the API field alone.

The `state=STALE` Bruce saw in his audit was from the OLD `/api/v1/market-data/overview` endpoint (KGI-dependent, not TWSE). The new TWSE endpoint returns yesterday's close data tagged as `sourceState: "lkg"` when the in-process LKG cache contains it, `"live"` when a fresh TWSE fetch succeeds. Both are correct values — just post-market data.

**Fix**: Added `taiexDisplayLabel` field to `/api/v1/market/overview/twse` response:
- `sourceState === "lkg"` → `taiexDisplayLabel: "上日收盤"`
- `sourceState === "live"` → `taiexDisplayLabel: "今日收盤"`
- `sourceState === "unavailable"` (null result) → field absent

**File changed**: `apps/api/src/server.ts` (2 lines in GET /api/v1/market/overview/twse handler)

**Codex action required**: Frontend should read `taiexDisplayLabel` from the response and display it instead of generic "即時" or blank. When `sourceState === "lkg"`, show "上日收盤 YYYY-MM-DD". When `"live"`, show "今日收盤".

---

## P1-B: netAbsoluteReturnPct alias added

**Root cause**: `headlineMetrics.netAbsoluteReturnPct` was null because `mapSnapshotToV47()` only emitted `netAbsoluteReturnAfterCost` (decimal, e.g. 7.5987) and the `netAbsoluteReturn` alias. The `Pct` variant (759.87%) was never computed.

**Fix**: Added `netAbsoluteReturnPct = Math.round(netAbsoluteReturnAfterCost * 10000) / 100` in `mapSnapshotToV47()`.

Expected result for cont_liq_v36:
- `netAbsoluteReturnAfterCost`: 7.5987 (decimal)
- `netAbsoluteReturn`: 7.5987 (alias, same value)
- `netAbsoluteReturnPct`: 759.87 (percent, ×100 with 2dp rounding)

**File changed**: `apps/api/src/server.ts` (3 lines in mapSnapshotToV47)

---

## P1-C: 5/14 Brief Backfill

**Status**: Admin backfill endpoint confirmed present at `POST /api/v1/admin/brief/backfill` (server.ts line 11597). Sanitizer (PR #471) already deployed to prod since 12:45 TST.

**To trigger** (requires Owner session cookie):
```sh
curl -X POST https://api.eycvector.com/api/v1/admin/brief/backfill \
  -H "Content-Type: application/json" \
  -H "Cookie: iuf_session=<OWNER_SESSION_COOKIE>" \
  -d '{"from":"2026-05-14","to":"2026-05-14"}'
```

Expected response:
```json
{
  "data": {
    "from": "2026-05-14",
    "to": "2026-05-14",
    "fired": ["2026-05-14"],
    "skipped": [],
    "errors": []
  }
}
```

**Note**: This endpoint requires a live Owner session. Cannot be called without `iuf_session` cookie. Backfill re-runs the full 5-layer review pipeline for today's brief with the sanitizer applied.

**Scope guard**: `from` and `to` are both `2026-05-14`. The endpoint will NOT touch 5/8, 5/12, or 5/13 briefs.

---

## Files Modified

- `apps/api/src/server.ts`
  - L9143-9148: `taiexDisplayLabel` field in `/api/v1/market/overview/twse`
  - L8283-8289: `netAbsoluteReturnPct` alias in `mapSnapshotToV47()`

---

## Build Results

- `pnpm --filter api typecheck`: PASS (no type errors)
- Contracts: no contract changes (no Zod schema changed)
- Tests: No test changes needed (both changes are additive fields, not behavior changes)

---

## Lane Boundary

- Changed: `apps/api/src/server.ts` (strategy route + TWSE overview route)
- Not changed: `market-data.ts`, `risk.ts`, `broker/*`, `apps/web/*`
- TWSE change is in the server.ts TWSE route block, explicitly allowed by task ("✅ 改 TWSE fetch / cache logic")
