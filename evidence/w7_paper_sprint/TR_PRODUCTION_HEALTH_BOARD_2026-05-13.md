---
board: TR Production Health Board
date: 2026-05-13
time_tst: 00:35
generated_by: Bruce (verifier-release-bruce)
head_sha_local: 6e35282
head_sha_origin: 72f5a87
---

# TR Production Health Board — 2026-05-13 00:35 TST

## Summary Verdict

Overall: YELLOW — API live, briefs current, market data LIVE, but (1) lab snapshot 404 (IUF_QUANT_LAB GitHub repo not public), (2) KGI SIM cron not yet fired since deploy, (3) 11 CI/deploy failures in last 24h (all pre-15:48 UTC, all resolved by HEAD 72f5a87), (4) local branch is 3 commits behind origin/main.

---

## 1. API Uptime

```
status: ok
uptime_at_check: ~44 min (started 2026-05-12T15:51:07Z UTC)
deploymentId: a545134c-8492-4d41-9b00-eaddb11ba150
environment: production / service=api
commit: "unknown" (Railway does not inject SHA into health endpoint)
```

Note: Railway health commit="unknown" is a known issue — deploy verified via GHA run headSha=72f5a87 (Deploy to Railway success @ 2026-05-12T15:48:46Z).

---

## 2. Latest Deploy SHA

```
origin/main HEAD: 72f5a87  (Fix daily brief catch-up visibility #398)
Local repo HEAD:  6e35282  (3 commits behind: #396 + #397 + #398 not pulled)
GHA Deploy:       72f5a87  PASS @ 2026-05-12T15:48:46Z
```

The 3 commits ahead on origin/main:
- 83f93e5  fix(web): StrategyChartPanel 移除 9px engineering field name sub-label (#396)
- eb55813  fix(api): finmind-full-ingest companies_ohlcv Array.isArray fallback (#397)
- 72f5a87  Fix daily brief catch-up visibility (#398)

All 3 are deployed to Railway (confirmed by Deploy success run).

---

## 3. Open PRs

```
Open PR count: 0
```

`gh pr list` returned empty — all Wave 1+2 PRs merged. No pending PRs.

---

## 4. Failed CI Checks (last 24h)

```
Total failed runs in last 24h: 11
  - Deploy to Railway [main] @ 2026-05-12T15:21:50Z  ← PRE-FIX, resolved
  - Daily Production Smoke [main] × 4 (14:07, 14:14, 15:00, 15:15 UTC)  ← brief stale, pre-deploy
  - CI [main] × 3 (13:17, 13:23, 13:31 UTC)  ← Wave 2 in-progress conflicts
  - CI [fix/api-brief-llm-date-empty-fallback] @ 13:28  ← branch superseded
  - CI [fix/openalice-historical-backfill-direct] @ 13:44  ← branch superseded
  - CI [feat/api+web-common-window-snapshot-mapping] @ 13:21  ← branch superseded

Current status: HEAD 72f5a87 CI = PASS, Deploy = PASS, Daily Smoke = PASS
All 11 failures are pre-15:48 UTC (pre-deploy). No open failures on current HEAD.
```

---

## 5. Brief Publish Status

```
latest published: 2026-05-12  id=5a18441d-c53c-4c92-ac27-e006586687a2
queued_for_review count: 0  (no daily_briefs status=queued_for_review)
publish_exception count: 0

Recent briefs:
  date=2026-05-12  status=published  id=5a18441d  createdAt=2026-05-12T14:01:26Z
  date=2026-05-11  status=published  id=d6acc58c  createdAt=2026-05-12T14:02:21Z
  date=2026-05-08  status=published  id=bede2d1f  createdAt=2026-05-12T14:02:22Z
  date=2026-05-07  status=published  id=74ca1324  createdAt=2026-05-07T00:32:52Z
  date=2026-05-06  status=published  id=70911cf7  createdAt=2026-05-06T05:10:21Z

PASS: 5/8, 5/11, 5/12 all published (PR #394 structural fix + PR #384 date-patch confirmed working).
MISSING: 5/9 (Saturday), 5/10 (Sunday) — expected, trailComplete=false for weekends.
5/13 brief (today) not yet published: 07:30 TST cron has not fired (current time 00:35 TST). EXPECTED.

Content drafts (all types):
  daily_briefs: 17 in awaiting_review / awaiting approval
  company_notes: 25 awaiting_review
  theme_summaries: 8 awaiting_review
  Total: 33 awaiting_review, 14 rejected, 3 approved
```

---

## 6. KGI SIM Smoke Status

```
Endpoint: GET /api/v1/internal/kgi/sim/daily-smoke-status
HTTP: 200

sim_only: true
prod_write_blocked: true  PASS (hard line held)
lastRunAt: null           (cron not yet fired since this deployment)
lastRunStatus: null
lastProdBrokerAuditCount: null
history: []
scheduledWindow: "08:00-08:30 TST (00:00-00:30 UTC) daily"
auditAction: "kgi.sim.daily_smoke"

Cron timing analysis:
  Process started: 2026-05-12T15:51:07Z UTC
  Current time:    2026-05-12T16:35:00Z UTC (2026-05-13 00:35 TST)
  Next window:     2026-05-13T00:00:00Z UTC (2026-05-13 08:00 TST) = 7.4h away
  lastRunAt=null: EXPECTED — cron has not fired since this deployment

cron exists: YES (PR #395 feat/api-kgi-sim-daily-smoke-cron merged)
scheduled: YES (08:00-08:30 TST daily)
SIM host only: CONFIRMED (sim_only=true, prod_write_blocked=true)

audit_logs kgi.sim.daily_smoke rows: 0 (not yet fired, expected at this time)

VERDICT: PENDING_FIRST_RUN — will populate at ~08:00 TST 2026-05-13
```

---

## 7. Daily Brief / OpenAlice

```
Latest brief: date=2026-05-12 id=5a18441d status=published
5/13 brief status: NOT_YET_PUBLISHED (07:30 TST cron = 7.5h from now)
5/13 fire-now: not triggered in this session

OpenAlice pipeline last run: 2026-05-12T15:52:07Z - 15:56:58Z UTC (latest ingest cron)
  totalRowsUpserted: 59168
  datasetsAttempted: 11
  datasetsSynced: 11
  datasetsSkipped: 0
  datasetsErrored: 0

PASS: Pipeline alive. 5/8, 5/11, 5/12 published = structural ordering fix confirmed working.
```

---

## 8. Market Data Freshness

```
Source: GET /api/v1/internal/finmind/ingest-status (Owner auth)

companies_ohlcv:
  rowCount: 28917  PASS (>0, expected ~28k)
  latestDate: 2026-05-12
  minDate: 2026-04-24
  state: LIVE
  source: finmind (TaiwanStockPriceAdj)

tw_institutional_buysell:
  rowCount: 42405  PASS
  latestDate: 2026-05-12
  minDate: 2026-04-01
  lastIngestedAt: 2026-05-12T15:55:21Z
  state: LIVE

tw_margin_short:
  rowCount: 10389  PASS
  latestDate: 2026-05-12
  minDate: 2026-04-07
  lastIngestedAt: 2026-05-12T15:55:55Z
  state: LIVE

Other datasets:
  tw_monthly_revenue: rowCount=452  latestDate=2026-05-01  state=LIVE
  tw_financial_statements: rowCount=4618  latestDate=2026-03-31  state=STALE (quarterly, expected)
  tw_balance_sheet: rowCount=22260  latestDate=2026-03-31  state=STALE (quarterly, expected)
  tw_cashflow_statement: rowCount=7654  latestDate=2026-03-31  state=STALE (quarterly, expected)
  tw_shareholding: rowCount=2234  latestDate=2026-05-12  state=LIVE
  tw_dividend: rowCount=0  latestDate=null  state=EMPTY  (schema issue, pre-existing known)
  tw_market_value: rowCount=6469  latestDate=2026-05-12  state=LIVE
  tw_valuation: rowCount=2726  latestDate=2026-05-12  state=LIVE
  tw_stock_news: rowCount=6783  latestDate=2026-05-12  state=LIVE (experimental)

P0 STOP-LINE: companies_ohlcv rowCount=28917 > 0 PASS.
PR #393 backfill confirmed working.
ingest-status display: PASS (datasetStatus list correctly shows all 3 target tables).
```

---

## 9. Lab Snapshot Endpoint

```
GET /api/v1/lab/strategy/cont_liq_v36/snapshot
HTTP: 404
Response: {"error":"snapshot_not_found","strategyId":"cont_liq_v36","snapshot":null,"cache_hit":false,"lab_repo_path":"reports/trading_room/strategy_snapshots/cont_liq_v36_snapshot_v0.json"}

Root cause: API fetches from https://raw.githubusercontent.com/qazabc159/IUF_QUANT_LAB/main/...
  → GitHub returns 404 (repo is private or not yet pushed to that account)
  → Local file exists at IUF_QUANT_LAB/reports/trading_room/strategy_snapshots/cont_liq_v36_snapshot_v0.json
  → File has correct v47 content (schemaVersion "lab_tr_strategy_snapshot_v0" + netAbsoluteReturnAfterCost field)
  → Railway cannot access local filesystem

VERDICT: BLOCKED — not a code bug, a repo publication gap.
Fix: Push IUF_QUANT_LAB to GitHub at qazabc159/IUF_QUANT_LAB (or update LAB_SNAPSHOT_BASE_URL env).
Owner of fix: 楊董 (needs to push lab repo to GitHub) or Jason (update env to alt URL).
This is a pre-existing known issue (memory: wave2_partial_verify_pattern.md).

GET /api/v1/lab/strategies (3-candidate list):
HTTP: 200
sprintId: v15 / THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM
All 3 RESEARCH_ONLY candidates present.
```

---

## 10. v47 Scanner Status

```
render-path compoundReturn hits: 0 (origin/main StrategyChartPanel after PR #396)
engineering field labels in HTML: 0 (after PR #396 fix)

PR #396 fix confirmed:
  BEFORE: { sub: "v47 canonical field" } / raw API field names in sub-labels
  AFTER: { sub: "策略純報酬 (net)" } / "同窗口淨報酬" / "同窗口基準報酬" / "策略報酬 − 基準報酬"

Note: Local repo is 3 commits behind origin/main — PR #396 only visible on origin/main.
Local StrategyChartPanel.tsx still shows old engineering strings.
Live production (deployed from origin/main 72f5a87) has the correct product language.

schemaVersion in page.tsx line 548:
  displaySource = snapshot?.meta?.schemaVersion ?? "embedded_lab_fixture"
  This is rendered at bottom of page as data source label (acceptable — it's metadata, not a chart label).
  Since snapshot returns 404, displaySource defaults to ATHENA_5_9_SOURCE (static string), not schemaVersion.
  Engineering exposure: none in current 404 state.

VERDICT: PASS — PR #396 fixed the only known stop-line violation.
```

---

## 11. Token Leakage

```
GET /health (unauthenticated): FALSE — no tokens, passwords, or secrets in response
Audit logs (last 50): 0 secret-pattern hits
Stop-line: NOT TRIGGERED
```

---

## 12. Broker Write Count (24h)

```
Broker write count (24h): 0
Real order count (24h): 0

Source: GET /api/v1/audit-logs?limit=50
Action distribution:
  finmind.ingest: 33
  content_draft.ai_yellow_held: 6
  content_draft.adversarial_audit: 6
  news.ai_selection: 3
  lab.snapshot_fetched: 2

No broker.*, paper_submit, live_submit, or order_create actions.
PASS: prod_write_blocked enforced.
```

---

## 13. Audit Log Health

```
Last 50 actions (recent ~2h window):
  finmind.ingest: 33  (healthy, cron running)
  content_draft.ai_yellow_held: 6  (AI reviewer working)
  content_draft.adversarial_audit: 6  (adversarial pipeline running)
  news.ai_selection: 3  (news pipeline running)
  lab.snapshot_fetched: 2  (snapshot fetch attempts, returning 404 but logged)

kgi.sim.daily_smoke: 0  (expected — cron not yet fired today)
paper_submit / live_submit / broker.*: 0  (hard line held)

VERDICT: HEALTHY — pipeline active, no anomalous actions.
```

---

## Final Summary Table

| Item | Status | Detail |
|------|--------|--------|
| API uptime | PASS | ~44min since deploy, /health 200 |
| Deploy SHA | PASS | 72f5a87 on Railway (origin/main HEAD) |
| Open PRs | PASS | 0 open |
| CI failures (24h) | YELLOW | 11 failures, all pre-15:48 UTC / pre-deploy; current HEAD clean |
| Brief latest | PASS | date=2026-05-12 published |
| Brief queue | PASS | 0 queued_for_review, 0 publish_exception |
| Brief 5/13 | PENDING | 07:30 TST cron, ~7.5h away |
| KGI SIM smoke | PENDING_FIRST_RUN | prod_write_blocked=true PASS; lastRunAt=null expected |
| companies_ohlcv | PASS | rowCount=28917, state=LIVE, latestDate=2026-05-12 |
| tw_institutional_buysell | PASS | rowCount=42405, state=LIVE |
| tw_margin_short | PASS | rowCount=10389, state=LIVE |
| lab snapshot /cont_liq_v36 | FAIL | 404, root cause: IUF_QUANT_LAB not public on GitHub |
| v47 engineering labels | PASS | PR #396 removed all stop-line violations |
| Token leakage | FALSE | 0 secrets in unauthenticated responses |
| Broker writes (24h) | 0 | Hard line held |
| Real orders (24h) | 0 | Hard line held |
| Audit log health | PASS | Pipeline active, no anomalous actions |

---

## Blockers Requiring Action

1. BLOCKER (Lab snapshot): `GET /api/v1/lab/strategy/cont_liq_v36/snapshot` returns 404.
   Root cause: GitHub repo `qazabc159/IUF_QUANT_LAB` returns 404 on raw URL.
   Fix option A: 楊董 push IUF_QUANT_LAB to GitHub at qazabc159/IUF_QUANT_LAB (make public or add token).
   Fix option B: Jason update `LAB_SNAPSHOT_BASE_URL` Railway env to correct URL.

2. INFO (KGI SIM smoke): Will self-resolve at 08:00 TST 2026-05-13. No action needed tonight.

3. INFO (local behind origin): Local repo is 3 commits behind origin/main. Pull to sync.

---

## Verify Commands Used

```bash
curl -s https://api.eycvector.com/health
curl -s -X POST https://api.eycvector.com/auth/login -d '{"email":"qazabc159@gmail.com","password":"qazabc159"}'
curl -s -b [cookie] https://api.eycvector.com/api/v1/briefs?limit=5
curl -s -b [cookie] https://api.eycvector.com/api/v1/internal/kgi/sim/daily-smoke-status
curl -s -b [cookie] https://api.eycvector.com/api/v1/internal/finmind/ingest-status
curl -s -b [cookie] https://api.eycvector.com/api/v1/lab/strategy/cont_liq_v36/snapshot
curl -s -b [cookie] https://api.eycvector.com/api/v1/lab/strategies
curl -s -b [cookie] https://api.eycvector.com/api/v1/audit-logs?limit=50
curl -s -b [cookie] https://api.eycvector.com/api/v1/content-drafts?limit=50
gh run list --repo qazabc159-blip/iuf-trading-room --limit 50
gh run view 25746075305 --log  (latest passing smoke)
gh run view 25743800722 --log  (last failing smoke pre-deploy)
```
