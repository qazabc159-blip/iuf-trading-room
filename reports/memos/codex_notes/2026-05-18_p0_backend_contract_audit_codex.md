# P0 Backend Contract Audit - Codex Slice

Generated: 2026-05-18 20:21 TST  
Scope: production API contract truth for Elva/Codex `P0-AUDIT-BOARD.md`  
Base: `https://api.eycvector.com`  
Auth: owner cookie from local browser cookie jar

This is not the full route audit board. It is the backend/API evidence slice that should be pasted into the board before PR-A to PR-F work starts.

Follow-up in this Codex branch: the Portfolio Snapshot 404 found below is fixed by adding read-only snapshot list/detail/diff routes. The audit row is preserved as the production truth observed before the patch.

## Executive Truth

Status: YELLOW

Production API is up, but several product surfaces are not contract-complete:

- AI recommendations have three competing surfaces. `/api/v1/recommendations/today` is live but still fixture/strategy-style output, not full product AI picks. `/api/v1/ai-recommendations` is old v2 and has stale/odd price fields. `/api/v1/ai-recommendations/v3` is the correct v3 surface and is live after refresh, but the web `/ai-recommendations` page currently reads `/recommendations/today`, not v3.
- Market intel `news-top10` is live with 10 AI-selected items, but official market announcements are empty, and heatmap industry grouping still uses English/TWSE/FinMind raw sector labels rather than Yang's fixed Taiwan representative groups.
- Trading room search and paper preview are live, but KGI live quote endpoints are blocked by gateway auth, and required 5m/15m/60m OHLCV intervals return 400.
- Company page data is mostly live for 2330, but quote realtime is degraded because KGI gateway is not authenticated, announcements are empty, and 12 company master records still contain mojibake.
- Portfolio Snapshot frontend calls `/api/v1/portfolio/snapshots`, but production backend returns 404. Store/schema exist, route is missing.
- ToolCenter registry/calls/stats are live.
- UTA has adapters/orders, positions are empty/partial. Keep admin-only or label Phase A/SIM clearly.
- Lab/Quant snapshots are live but research-only. Frontend must not present them as tradable.

## Contract Table

| Product Area | Endpoint | Prod Result | Classification | What Elva/Codex Should Do |
|---|---|---:|---|---|
| infra | `GET /health` | 200 `status=ok` | LIVE | baseline OK |
| dashboard | `GET /api/v1/dashboard/snapshot` | 200 | PARTIAL | usable, but heatmap source still raw sector based |
| AI rec | `GET /api/v1/recommendations/today` | 200, 4 items | PARTIAL | not enough for final product: strategy fixture language, missing numeric entry/stop/TP for some items |
| AI rec | `GET /api/v1/ai-recommendations` | 200, 3 items | PARTIAL | old v2; includes stale/odd fields like `tp1=1`, English/Japanese rationale; do not use as final frontend contract |
| AI rec | `GET /api/v1/ai-recommendations/v3` | 200 after refresh, 3 items | LIVE | this is the likely PR-A source; wire frontend to it or map it into `/recommendations/today` |
| market intel | `GET /api/v1/market-intel/news-top10` | 200, 10 items, `selection_mode=ai` | LIVE | good base for AI news block; frontend must show why-matters/company/theme links |
| market intel | `GET /api/v1/market-intel/news-top10/with-sentiment` | 200, 10 items | LIVE | optional sentiment source |
| market intel | `GET /api/v1/market-intel/announcements?scope=market` | 200, 0 items, source empty | EMPTY | honest empty state required; do not pretend official announcements exist |
| market intel | `GET /api/v1/data-sources/finmind/status` | 200 `LIVE_READY` | LIVE | source status can be displayed |
| heatmap | `GET /api/v1/market/heatmap/twse` | 200, 87 groups | PARTIAL | English/raw sector groups; fails Yang fixed representative industry rule |
| heatmap | `GET /api/v1/market/heatmap/kgi-core` | 200, 40 tiles | PARTIAL | usable core stock fallback; not yet 10-15 per industry representative model |
| heatmap | `GET /api/v1/market/heatmap/finmind` | 200, 107 groups | PARTIAL | English/raw sector groups; do not use as final Taiwan industry heatmap |
| trading room | `GET /api/v1/companies/lookup?q=2454` | 200 | LIVE | ticker search works |
| trading room | `GET /api/v1/companies/lookup?q=聯發科` | 200 | LIVE | Chinese name search works |
| trading room | `GET /api/v1/kgi/quote/status` | 200, `kgi_logged_in=false` | PARTIAL | gateway not authenticated; frontend must label degraded |
| trading room | `GET /api/v1/kgi/quote/bidask?symbol=2454` | 503 gateway auth | BROKEN | do not show live bid/ask as available |
| trading room | `GET /api/v1/kgi/quote/ticks?symbol=2454` | 503 gateway auth | BROKEN | do not show live ticks as available |
| trading room | `GET /api/v1/kgi/quote/kbar?symbol=2454` | 503 gateway auth | BROKEN | do not show KGI kbar as available |
| trading room | `GET /api/v1/paper/health` | 200 | LIVE | paper execution service ready |
| trading room | `GET /api/v1/paper/portfolio` | 200, empty | EMPTY | correct empty state: no filled orders yet |
| trading room | `GET /api/v1/paper/orders` | 200, empty | EMPTY | correct empty state |
| trading room | `GET /api/v1/paper/fills` | 200, empty | EMPTY | correct empty state |
| trading room | `POST /api/v1/paper/orders/preview` | 200 | LIVE | paper preview works; no DB write |
| trading room | `GET /api/v1/portfolio/kgi/positions` | 200, gateway_not_authenticated | DEGRADED | KGI read-only positions must show degraded reason |
| trading room K-line | `GET /api/v1/companies/2330/ohlcv?interval=1d` | 200, 726 rows | LIVE | OK |
| trading room K-line | `GET /api/v1/companies/2330/ohlcv?interval=1w` | 200, 200 rows | LIVE | OK |
| trading room K-line | `GET /api/v1/companies/2330/ohlcv?interval=1m` | 200, 200 rows | LIVE | OK |
| trading room K-line | `GET /api/v1/companies/2330/ohlcv?interval=5m` | 400 validation | BROKEN | PR-C must either implement/resample 5m or disable button |
| trading room K-line | `GET /api/v1/companies/2330/ohlcv?interval=15m` | 400 validation | BROKEN | PR-C must either implement/resample 15m or disable button |
| trading room K-line | `GET /api/v1/companies/2330/ohlcv?interval=60m` | 400 validation | BROKEN | PR-C must either implement/resample 60m or disable button |
| ideas | `GET /api/v1/strategy/ideas?...` | 200, 8 items | LIVE | currently all blocked/review-style; do not call this AI recommendation output |
| companies | `GET /api/v1/companies?limit=20` | 200 | LIVE_WITH_DATA_QUALITY_ISSUE | 12 of 1734 company records contain mojibake |
| companies | `GET /api/v1/themes/index?limit=20` | 200 | LIVE | source exists |
| company 2330 | `GET /api/v1/companies/2330/quote/realtime` | 200, `state=BLOCKED`, gateway auth error | DEGRADED | company quote panel must show degraded, not blank/live |
| company 2330 | `GET /api/v1/companies/2330/kbar?days=5` | 200 `state=LIVE`, source FINMIND | LIVE | OK |
| company 2330 | `GET /api/v1/companies/2330/announcements?days=30` | 200, 0 items | EMPTY | formal empty state required |
| company 2330 | `GET /api/v1/companies/2330/financials?limit=8` | 200, 8 rows | LIVE | OK |
| company 2330 | `GET /api/v1/companies/2330/revenue?limit=12` | 200, 13 rows | LIVE | OK |
| company 2330 | `GET /api/v1/companies/2330/chips?days=30` | 200 | LIVE | OK |
| company 2330 | `GET /api/v1/companies/2330/full-profile` | 200 | LIVE | OK |
| EventLog | `GET /api/v1/event-history?limit=20` | 200, 20 rows | LIVE | use this as visible event feed if streams empty |
| EventLog | `GET /api/v1/event-streams` | 200, 0 rows | EMPTY | formal empty state required |
| EventLog | `GET /api/v1/admin/event-log/outbox/diag` | 200, poller running, counts -1 | PARTIAL | counts need honest "diagnostic unavailable" wording |
| Portfolio Snapshot | `GET /api/v1/portfolio/snapshots?limit=10` | 404 at audit time | BROKEN -> FIXED_IN_THIS_BRANCH | backend route was missing despite schema/store; this branch adds read-only list/detail/diff routes |
| ToolCenter | `GET /api/v1/tools/registry` | 200, 12 tools | LIVE | OK, but frontend must show executable vs demo/disabled |
| ToolCenter | `GET /api/v1/tools/calls?limit=10` | 200 | LIVE | OK |
| ToolCenter | `GET /api/v1/tools/stats?window=24h` | 200 | LIVE | OK |
| UTA | `GET /api/v1/uta/adapters` | 200 | LIVE | admin-only Phase A is OK |
| UTA | `GET /api/v1/uta/orders?limit=10` | 200 | LIVE | OK |
| UTA | `GET /api/v1/uta/positions` | 200, empty positions | PARTIAL | mark SIM/Phase A or hide from main product |
| Quant/Lab | `GET /api/v1/lab/strategy-snapshot` | 200 | LIVE_RESEARCH_ONLY | show research-only; not tradable |
| Quant/Lab | `GET /api/v1/lab/strategies` | 200 | LIVE_RESEARCH_ONLY | alias OK |
| Quant/Lab | `GET /api/v1/lab/strategy/cont_liq_v36/snapshot` | 200, source local_embedded | LIVE_RESEARCH_ONLY | OK with caveat |
| Quant/Lab | `GET /api/v1/lab/three-strategy/snapshot` | 200 | LIVE_RESEARCH_ONLY | OK with caveat |
| alerts | `GET /api/v1/alerts?limit=20` | 200, empty | EMPTY | formal empty state |
| signals | `GET /api/v1/signals?limit=20` | 200, 10 rows | LIVE | OK |
| plans | `GET /api/v1/plans?limit=20` | 200, 1 row | LIVE | OK |
| briefs | `GET /api/v1/briefs` | 200, 16 rows | LIVE_WITH_DATA_QUALITY_ISSUE | 3 of 16 briefs contain mojibake |

## Priority Fix Handoff

### PR-A Backend Contract Requirement

Do not treat `/api/v1/recommendations/today` as final AI picks unless it is remapped to v3 or upgraded. Current `/today` item sample is still generated by `iuf_recommendation_orchestrator_v1`, uses cont_liq fixture language, and has null target prices.

Recommended path:

1. Frontend `/ai-recommendations` should read `/api/v1/ai-recommendations/v3` for the v3 panel and recommendation cards, or backend should map v3 result into `/api/v1/recommendations/today`.
2. Remove/degrade the hardcoded v3 UI placeholder that passes null scores and null trace.
3. Do not use `/api/v1/ai-recommendations` v2 as final output; it currently includes stale English/Japanese rationale and odd price fields.

### PR-B Backend Contract Requirement

Current heatmap endpoints are live but fail the product rule:

- TWSE/FinMind heatmaps expose English/raw sector labels.
- KGI core heatmap has 40 stocks, but not fixed 10-15 representative stocks per Taiwan industry.

Recommended path:

1. Add fixed Taiwan industry representative config.
2. Build a new or remapped heatmap response around those groups.
3. Keep existing TWSE/FinMind endpoints as raw source/fallback, not as final product grouping.

### PR-C Backend Contract Requirement

Trading room can be made honest now:

- Search works.
- Paper preview works.
- Paper portfolio/orders/fills correctly show empty.
- KGI quote/tick/kbar and company realtime quote are degraded because gateway is not authenticated.
- 5m/15m/60m OHLCV intervals currently 400.

Recommended path:

1. Disable or label KGI live quote widgets when `kgi_logged_in=false`.
2. Either implement 5m/15m/60m resampling or disable those timeframe controls with `NO_INTRADAY_INTERVAL`.
3. Keep paper submit separate from KGI SIM/Real. Real remains disabled.

### PR-D Backend Contract Requirement

Company page has enough data for non-empty panels, but:

- quote realtime must show KGI degraded reason;
- announcements must show official empty state;
- company master data cleanup is needed for 12 mojibake records.

### PR-F Backend Contract Requirement

Portfolio Snapshot was a real backend gap at audit time:

- `portfolio_snapshots` schema and store exist.
- production route `/api/v1/portfolio/snapshots` returned 404.
- frontend admin page already calls this route.

This branch turns it into a small backend PR before UX polish.

## Data Quality Findings

Company master mojibake: 12 / 1734 records flagged. Examples:

- 6738: `鼎��`
- 6776: `展�眥篕�`
- 2432: `倚天酷��-創`
- 6285: `啟��`
- 3046: `建��`
- 8349: `�矬�`
- 6690: `安�硌穈T`
- 6811: `宏�硌穈T`
- 6908: `宏�砦C戲`
- 8111: `立��`
- 6174: `安��`

Brief mojibake: 3 / 16 records flagged:

- `38ee9d36-421b-4a29-8776-4ba45a863ed1`, asOf `2026-05-17`
- `fb0a76a8-2e00-4a97-bd2f-3210c0041f09`, asOf `2026-05-16`
- `e34745eb-62f7-47a7-a365-a0b33e3e5011`, asOf `2026-04-24`

## Suggested Elva Instruction

Elva should assign this slice as follows:

- Jason/API: wire v3 AI recommendation source into final product contract or update web page to consume v3 directly.
- Jason/API: consume the new portfolio snapshot list/detail/diff routes and render honest empty state when no snapshots exist.
- Jason/API or Mike: add 5m/15m/60m OHLCV contract or return a typed degraded response instead of validation 400.
- Bruce: production verify `/ai-recommendations`, `/market-intel`, `/portfolio`, `/companies/2330`, `/admin/portfolio/snapshots`, `/admin/tools`, `/admin/events` after each PR.
- Web Codex: render degraded/empty states for KGI quote, announcements, alerts, event streams, and paper empty ledger; do not show blank panels.

