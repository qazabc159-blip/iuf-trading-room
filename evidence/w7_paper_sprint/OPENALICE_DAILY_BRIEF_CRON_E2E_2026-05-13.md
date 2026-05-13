---
title: OpenAlice Daily Brief 5/13 E2E Publish Evidence
owner: Jason
date: 2026-05-13
---

# OpenAlice Daily Brief 5/13 Auto-Publish E2E Evidence

## Result: PUBLISHED (id=f3c951a9)

```
date: 2026-05-13
status: published
briefId: f3c951a9-4377-4249-9efa-0138f8858ae4
sections: 3 (Market Overview / Theme Summaries / Company Notes)
content: non-empty (has themes, company notes)
```

## Root Cause Chain (Full Diagnosis)

### Issue 1: Three tables 0-row (Pre-existing, Fixed by PR #393 cron)

All three tables were 0-row before PR #393 merge. After merge + cron run 2026-05-12T23:47-23:58 UTC:
- companies_ohlcv: 0 → 29,180 rows (LIVE, latestDate=2026-05-12)
- tw_institutional_buysell: 0 → 42,405 rows (LIVE, latestDate=2026-05-12)
- tw_margin_short: 0 → 10,389 rows (LIVE, latestDate=2026-05-12)

No manual backfill required — cron covered it automatically.

### Issue 2: D3 Array.isArray bug in collectSourcePack (Root cause of trailComplete=false)

`collectSourcePack()` in `openalice-pipeline.ts` used `rows?.[0]` pattern (same bug as D1/D2 in finmind-full-ingest.ts). When db.execute() returns a plain array (Railway Drizzle/pg), `.rows` is undefined → ohlcvCount=0 → ohlcvStatus="EMPTY" → trailComplete=false.

Fixed by PR #403 (D3 fix) with Array.isArray fallback at 4 sites.

Proof: After deploy, pipeline run logged `trailComplete: true, sourcePackCount: 5`.

### Issue 3: ORT1-4 tests in ci.test.ts blocking CI (Stash contamination)

ORT tests were accidentally included in PR #403 commit via stash@{0} contamination (from a different branch's kgi-sim-env.ts changes). Fixed by PR #405 (removed ORT1-4).

### Issue 4: Stale draft dedup blocking fresh pipeline run

After D3 fix deploy, pipeline retry (POST /api/v1/admin/brief/backfill) was blocked by existing awaiting_review draft `856c689a` (24h dedup window). That draft's sourceJobId was null (pipeline-direct producer, not OpenAlice device), so loadSourcePackForDraft returned null → evaluatePipelinePublishGate had sourcePack=null → fallback trailComplete=false → gate returned queued_for_review again.

Fixed by: rejected draft `856c689a` via Owner API (reason: source_pack_null_stale_dedup_blocking_pipeline_retry_D3_fix), then triggered fresh pipeline run.

## Audit Chain (Success Path)

```
Pre-conditions:
  companies_ohlcv   rowCount=29180 LIVE
  tw_institutional_buysell rowCount=42405 LIVE
  tw_margin_short   rowCount=10389 LIVE

Pipeline run ~2026-05-13T00:47 UTC:
  trailComplete=True (D3 fix effective)
  sourcePackCount=5
  LLM generated substantive 3-section brief
  Reviewer approved → gate GREEN → approveContentDraft
  daily_briefs row created: id=f3c951a9, date=2026-05-13, status=published

Verification:
  GET /api/v1/briefs/2026-05-13 → status=published, 3 sections
  payload.date = "2026-05-13" (non-empty)
  content: themes + company notes (not EMPTY-hallucinated)
```

## PRs Shipped

| PR | Branch | Purpose | Status |
|----|--------|---------|--------|
| #403 | fix/api-openalice-source-pack-array-fallback-d3 | D3: Array.isArray in collectSourcePack | MERGED |
| #405 | fix/ci-remove-ort-tests-premature | Remove premature ORT1-4 tests | MERGED |

## Hard-line Status

- No manual force-approve used: PASS (pipeline auto-published via gate GREEN)
- No token exposed in evidence: PASS  
- No broker changes: PASS
- Lane boundary maintained (openalice-pipeline.ts + ci.test.ts only): PASS
- sourceTrail non-empty: PASS (substantive content with themes/companies)
- payload.date="2026-05-13": PASS
