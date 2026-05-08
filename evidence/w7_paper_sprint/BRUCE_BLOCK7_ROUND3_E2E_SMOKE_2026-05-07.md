---
session: BLOCK #7 Round 3 E2E Smoke
date: 2026-05-07
verifier: Bruce
scope: PR #270 deploy confirm + announcements ingest + TWSE + 4-page frontend walk-through
auth: qazabc159@gmail.com (Owner) — iuf_session cookie confirmed
---

# BRUCE BLOCK #7 ROUND 3 — E2E SMOKE REPORT
# 2026-05-07 TST ~13:20

## Auth Gate
POST https://api.eycvector.com/auth/login
Result: HTTP 200 / user.role=Owner
Verdict: GREEN

---

## A. PR #270 Email Digest Deploy Confirm

Endpoint: GET /api/v1/internal/openalice/email-digest/state
HTTP: 200

Response:
  lastDigestAt: 2026-05-07T05:08:14.508Z
  lastResult.sent: true
  lastResult.reason: null
  lastResult.recipient: qazabc159@gmail.com
  lastResult.eventCount: 0

Verdict: GREEN
- sent=true + reason=null confirms Resend fix (PR #270) is deployed and live
- Email was dispatched at 05:08 UTC (13:08 TST) to correct recipient
- eventCount=0 is expected (no pending alerts at time of digest)
- Cannot verify inbox directly but sent=true + reason=null = production wire confirmed per pattern

---

## B. Announcements Ingest — news.state 3-ticker Verify

Checked: 2330 / 2317 / 2454

| Ticker | news.state | degradedReason | rows | notes |
|--------|-----------|----------------|------|-------|
| 2330   | EMPTY     | null (at full-profile level) | 0 | sourceTrail.degradedReason=no_rows |
| 2317   | EMPTY     | null | 0 | same |
| 2454   | EMPTY     | null | 0 | same |

### Root Cause — TaiwanStockNews Circuit Breaker OPEN

GET /api/v1/data-sources/finmind/status confirms:
  circuitOpen: true
  circuitOpenedAt: 2026-05-07T05:09:53.714Z
  circuitOpenUntil: 2026-05-07T05:39:53.714Z  (30min circuit)
  circuitDataset: TaiwanStockNews
  circuitReason: "http_400: the dataset TaiwanStockNews size is too large, we only send one day data, so end_date parameter need be none."
  circuitSkipCount: 185
  forbiddenCount: 1

TaiwanStockNews dataset:
  state: DEGRADED
  rowCount: 0
  latestDate: null
  degradedReason: high_error_rate
  experimental: true

### Verdict: YELLOW — NOT a blocker, but root cause is a query parameter bug
- The FinMind token IS present (tokenPresent=true, quotaTier=sponsor999)
- The 30-min tick DID fire (circuitOpenedAt shows the attempt happened)
- The call FAILED with HTTP 400 from FinMind: end_date parameter sent when it should be omitted for TaiwanStockNews
- Circuit breaker is protecting from repeat failures (185 skips)
- news.state=EMPTY across all 3 tickers is consistent with this circuit-open state
- Self-heals when: Jason fixes TaiwanStockNews query to omit end_date param (FinMind API restriction)
- Assign fix: Jason

### FinMind overall health:
  tokenPresent: true
  quotaTier: sponsor999
  requestCount: 953 (of 6000/hr)
  errorRate: 0.1%
  lastDataset: TaiwanStockPER (non-news fetches working normally)

---

## C. TWSE Announcements

Endpoint: GET /api/v1/companies/2330/announcements?days=30
HTTP: 200

Response:
  state: DEGRADED
  degradedReason: twse_upstream_non_json
  data: [] (0 items)

Verdict: DEGRADED — honest state reporting confirmed
- PR #265 fetchTwse Content-Type guard is deployed and working
- State field present, value = DEGRADED (not a crash / not silent EMPTY)
- degradedReason: twse_upstream_non_json = TWSE upstream returning non-JSON (HTML or empty)
- This is correct honest behavior — TWSE OpenAPI known to return HTML-over-200 silently
- No fix available from repo side (upstream TWSE issue)
- Per memory pattern: TWSE OpenAPI HTTP 200+HTML silent fail is known + confirmed

---

## D. Frontend 4-Page Walk-Through

### D1. Homepage — https://app.eycvector.com/
HTTP: 200 | body_len: 49,367 bytes

Signals detected:
  [brief]: 13 hits
  [OpenAlice]: 14 hits
  [paper]: 13 hits
  dates: ['2026-03-31', '2026-05-01', '2026-05-06', '2026-05-07']

Homepage cockpit signals:
  - 2026-05-07 brief date visible in RSC payload (latest brief = today's date)
  - OpenAlice state: 正常 (confirmed in RSC: class="status-ok")
  - brief preview section present (class="tg status-ok" + strong 2026-05-07)
  - 今日簡報已發布 visible (brief published today confirmed)
  - Paper workflow surface present
  - No BLOCKED or killSwitchBlocked visible in homepage hero

Verdict: GREEN — homepage correctly shows 2026-05-07 brief, OpenAlice=正常

### D2. Company Page 2330 — https://app.eycvector.com/companies/2330
HTTP: 200 | body_len: 60,596 bytes

Signals detected:
  [kbar]: 12 hits
  [ohlcv/OHLCV]: 4+4 hits
  [financials]: 1 hit
  [2330]: 22 hits
  [announce]: 3 hits

OHLCV API confirm: GET /api/v1/companies/2330/ohlcv?limit=5
  rows: 7 (limit=5 + paging)
  latest bar: dt=2026-05-06 / open=2250 / close=2250 / source=tej
  Verdict: K-line LIVE with 2026-05-06 data

Verdict: GREEN — k-line present, ohlcv wired, 11-dataset surface partial but rendering

### D3. Portfolio Page — https://app.eycvector.com/portfolio
HTTP: 200 | body_len: 23,228 bytes

Signals detected:
  [20,000]: 6 hits (NT$20,000 confirmed)
  [paper]: 14 hits
  [portfolio]: 42 hits
  [empty]: 4 hits (empty_state confirmed)
  [submit]: 2 hits

API confirm: GET /api/v1/paper/portfolio
  HTTP 200
  summary.baseCapitalTWD: 20000
  summary.simulated: true
  summary.paperMode: true
  summary.positionCount: 0
  summary.investedCostTWD: 0
  summary.note: "empty_state: no filled orders yet; base capital available"
  data: [] (no orders)

Portfolio page visible signals:
  - NT$20,000 balance shown
  - empty_state confirmed
  - paper mode active
  - submit surface present (BLOCKED wording visible in context of killSwitch)
  - GET /api/v1/paper/portfolio refreshed at 05/07 13:19 (visible in page)

Verdict: GREEN — 20k paper empty state correctly displayed, portfolio API live

### D4. Briefs Page — https://app.eycvector.com/briefs
HTTP: 200 | body_len: 44,972 bytes

Signals detected:
  [brief]: 62 hits
  [2026]: 46 hits
  [published]: 10 hits
  [OpenAlice]: 23 hits
  dates range: 2026-05-02 to 2026-05-07

API confirm: GET /api/v1/briefs?limit=5
  HTTP 200
  total: 7 published briefs
  latest: 2026-05-07 | status=published
  sample: 2026-05-03, 2026-05-04 also published

Verdict: GREEN — briefs listing live, 7 published, latest = today 5/7

---

## Summary Table

| Check | Endpoint | Verdict | Notes |
|-------|----------|---------|-------|
| A. Email digest PR #270 | /email-digest/state | GREEN | sent=true reason=null recipient=qazabc159@gmail.com |
| B. News 2330 ingest | /companies/2330/full-profile | YELLOW | EMPTY — circuit-open TaiwanStockNews end_date param bug; Jason fix needed |
| B. News 2317 ingest | /companies/2317/full-profile | YELLOW | same circuit-open cause |
| B. News 2454 ingest | /companies/2454/full-profile | YELLOW | same circuit-open cause |
| C. TWSE announcements | /companies/2330/announcements | DEGRADED_HONEST | state=DEGRADED twse_upstream_non_json; correct honest behavior |
| D1. Homepage cockpit | app.eycvector.com/ | GREEN | 5/7 brief, OpenAlice=正常, paper surface |
| D2. Company page 2330 | app.eycvector.com/companies/2330 | GREEN | kbar+ohlcv present, 2026-05-06 latest |
| D3. Portfolio | app.eycvector.com/portfolio | GREEN | 20k empty state, simulated=true, paperMode=true |
| D4. Briefs | app.eycvector.com/briefs | GREEN | 7 published, latest=2026-05-07 |

---

## OpenAlice Worker Health (background)

ops/snapshot.openAlice:
  workerStatus: healthy
  sweepStatus: healthy
  workerHeartbeatAgeSeconds: 7
  queuedJobs: 0
  runningJobs: 0
  terminalJobs: 736
  publishedBriefs: 7

Verdict: OpenAlice pipeline is fully healthy. Queue drained. Worker heartbeat 7s ago.

---

## Follow-Up Issues

### ISSUE-1 [YELLOW / Jason fix needed]
TaiwanStockNews FinMind query sends end_date param which FinMind disallows for this dataset.
- Error: http_400 "size is too large, end_date parameter need be none"
- Circuit opened: 2026-05-07T05:09:53Z
- Fix: Remove end_date from TaiwanStockNews fetch call in market-ingest.ts or equivalent
- Impact: news.state stuck EMPTY across all tickers until fix deployed
- NOT a blocker for current BLOCK #7 scope (news is experimental, state = honest EMPTY)

### ISSUE-2 [DEGRADED_KNOWN / no repo fix]
TWSE announcements upstream returning non-JSON
- degradedReason: twse_upstream_non_json
- State reporting is honest (DEGRADED not silent EMPTY)
- No fix from repo — TWSE upstream issue

---

## Deploy Confirm

- PR #270 (Resend fix): CONFIRMED LIVE (sent=true)
- Codex frontend PR #262: CONFIRMED (homepage/briefs/portfolio all rendering with 2026-05-07 content)
- OpenAlice pipeline: CONFIRMED HEALTHY (worker 7s heartbeat, queue=0, 7 briefs published)
- Paper mode: CONFIRMED (baseCapitalTWD=20000, simulated=true, empty state)
- K-line 2330: CONFIRMED LIVE (2026-05-06 bars, source=tej)

---

## BLOCK #7 Frontend Walk-Through Verdict

OVERALL: GREEN with 1 YELLOW (news EMPTY) and 1 DEGRADED_KNOWN (announcements)

Can deploy: N/A (already deployed, verified live)
Can declare BLOCK #7 smoke PASS: YES — all primary surfaces GREEN
Follow-ups: Jason news end_date fix (YELLOW, non-blocking)

Stop-lines triggered: 0
Write-side actions: 0
KGI interactions: 0
