# Ideas Signal Pipeline Status — 2026-05-13
# Verifier: Bruce | Segment A companion

## Status: PIPELINE_RUNNING_DATA_INSUFFICIENT

### API Evidence

```
GET /api/v1/strategy/ideas
HTTP 200
{
  "state": "LIVE",
  "generatedAt": "2026-05-13T00:57:20.495Z",
  "summary": {
    "total": 0, "allow": 0, "review": 0, "block": 0
  },
  "items": []
}
```

RSC payload (in-page SSR):
```
state: LIVE
generatedAt: 2026-05-13T00:55:08.190Z
total: 30, allow: 0, review: 0, block: 30, insufficient: 30
primaryReasons: [{ reason: "missing_bars", total: 30 }]
```

### Root Cause

OHLCV (companies_ohlcv):
- minDate: 2026-04-24
- latestDate: 2026-05-12
- rowCount: 29,180
- Trading days available: ~13

Ideas z-score formula requires: z[volumeRatio5To20] + z[trailRet20d]
- trailRet20d needs 20 bars minimum
- Current bars: ~13 (INSUFFICIENT by 7 trading days)

This is a DATA ACCUMULATION issue, NOT a code bug.
Pipeline is running, scoring is running, but all 30 evaluated companies fail the bar count gate.

### Fix Options

**Option A — Wait (natural)**: ~7 more trading days (approx 2026-05-22)
- No code change needed
- OHLCV ingest runs nightly, accumulating bars

**Option B — Backfill OHLCV to earlier date**: Jason task
- Trigger backfill to fetch OHLCV from 2026-04-01 or earlier
- Gives immediate 20+ bars for all companies
- Estimated: 1-2h for Jason to trigger

**Option C — Lower min bar threshold**: Jason/Codex task
- Reduce z-score minimum bars from 20 to 13
- NOT RECOMMENDED: changes strategy spec behavior

### UI Empty State

CSR component (ideas page) should display:
"今日沒有符合條件的研究觀察項"

Cannot verify via curl (CSR-only). Browser verification required for full confirm.
The v0.3 CSS (strategy-ideas-v03_ x244) is confirmed loaded, so CSR component is deployed.

### Is This a Blocker?

No. Ideas pipeline:
- Is running (LIVE state)
- Is correctly evaluating companies
- Is correctly gating on insufficient data
- Will self-resolve in ~7 trading days

Not a stop-line. Not a code regression. Escalate to Jason only if楊董 wants immediate backfill.

### Owner

- Option A: No owner needed
- Option B: Jason (OHLCV backfill trigger)
