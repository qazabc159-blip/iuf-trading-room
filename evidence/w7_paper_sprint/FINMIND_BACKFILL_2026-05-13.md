---
title: FinMind 三表 Backfill Evidence — 2026-05-13
owner: Jason
date: 2026-05-13
---

# FinMind 三表 Backfill Status — 2026-05-13

## Summary

三表均已 LIVE — 昨晚 2026-05-12T23:47-23:58 UTC finmind cron 自動 ingest 成功。
手動 backfill POST 不需要（資料已在）。PR #393 endpoint 正常。

## 三表 rowCount Before/After

以下為 2026-05-13T00:48 UTC `GET /api/v1/internal/finmind/ingest-status` 快照。

```
dataset: TaiwanStockPriceAdj (companies_ohlcv)
  rowCountBefore: 0 (pre-PR #393 deploy)
  rowCountAfter:  29,180
  minDate:        2026-04-24
  latestDate:     2026-05-12
  state:          LIVE
  source:         finmind (cron auto-ingest 2026-05-12T23:47 UTC)
  errorRows:      0
  apiCallEstimate: ~550 calls/run (sponsor limit 6000/hr)

dataset: TaiwanStockInstitutionalInvestorsBuySell (tw_institutional_buysell)
  rowCountBefore: 0 (pre-PR #393 deploy)
  rowCountAfter:  42,405
  minDate:        2026-04-01
  latestDate:     2026-05-12
  lastIngestedAt: 2026-05-12 23:56:18 UTC
  state:          LIVE
  source:         finmind (cron auto-ingest)
  errorRows:      0

dataset: TaiwanStockMarginPurchaseShortSale (tw_margin_short)
  rowCountBefore: 0 (pre-PR #393 deploy)
  rowCountAfter:  10,389
  minDate:        2026-04-07
  latestDate:     2026-05-12
  lastIngestedAt: 2026-05-12 23:57:00 UTC
  state:          LIVE
  source:         finmind (cron auto-ingest)
  errorRows:      0
```

## ingest-status API 回應 (抄錄關鍵欄位)

```json
{
  "lastRun": {
    "runId": "cb8aa62a-bed9-4f5b-999f-24034ff4a22d",
    "triggeredBy": "cron",
    "startedAt": "2026-05-12T23:47:48.901Z",
    "finishedAt": "2026-05-12T23:58:28.514Z",
    "totalDurationMs": 639613,
    "totalRowsUpserted": 59192,
    "datasetsAttempted": 11,
    "datasetsSynced": 11,
    "datasetsSkipped": 0,
    "datasetsErrored": 0
  }
}
```

## Verify 結論

- companies_ohlcv: rowCount=29180, latestDate=2026-05-12, state=LIVE  (PASS)
- tw_institutional_buysell: rowCount=42405, latestDate=2026-05-12, state=LIVE  (PASS)
- tw_margin_short: rowCount=10389, latestDate=2026-05-12, state=LIVE  (PASS)

三表全部 rowCount > 0, state = LIVE. 停止線已過。

## Hard-line Status

- No token exposed in evidence: PASS
- No manual force-approve: N/A (backfill auto-ran via cron)
- No broker changes: PASS
- FinMind unrestricted per 2026-05-09 memory: PASS
