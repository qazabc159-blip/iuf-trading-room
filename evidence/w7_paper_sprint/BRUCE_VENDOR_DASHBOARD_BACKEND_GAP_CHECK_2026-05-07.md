# BRUCE — Vendor Dashboard Backend Field Gap Check
Date: 2026-05-07 | Auditor: Bruce | Read-only, no code changes

## Source inputs
- Vendor zip: `C:/Users/User/Downloads/_ (2).zip`
  - handoff/BACKEND_SPEC.md, DATA_CONTRACTS.md, COMPONENTS.md, STATUS_RULES.md, OPENAPI.yaml
- IUF API: `apps/api/src/server.ts` (all routes scanned)

---

## Gap Table

| Panel | Vendor endpoint | Vendor expects | IUF existing endpoint | Shape gap | Missing fields | Owner | Pri |
|---|---|---|---|---|---|---|---|
| Top marquee | GET /api/v1/quotes | `{sourceState, sourceLabel, indices[], flows[], stocks[], intradayTwii[60]}` | /api/v1/market-data/overview | DOES NOT EXIST as /quotes | Entire endpoint missing; overview returns internal diagnostic shape (providers/leaders/quality), NOT indices/flows/stocks/intradayTwii | Jason | P0 |
| Command bar | GET /api/v1/meta | `{operator, mode, market, nowText, formalOrder:{state:"blocked",reason}}` | NONE | DOES NOT EXIST | Entire endpoint missing | Jason | P0 |
| Task rhythm | GET /api/v1/agenda | `AgendaItem[]{time,label,state}` | NONE | DOES NOT EXIST | Entire endpoint missing | Jason | P1 |
| Hero — TWII + intraday | (from /quotes) | `quotes.indices[0].{price,chg,pct}` + `quotes.intradayTwii[60]` | (see /quotes row) | blocked by /quotes missing | intradayTwii 60-point array not computed anywhere in IUF | Jason | P0 |
| Hero — breadth | GET /api/v1/breadth | `{up,flat,down,total,asOf}` | /api/v1/market-data/overview | DOES NOT EXIST as /breadth | overview.breadth exists internally but not exposed at /api/v1/breadth; also missing `asOf` ISO timestamp | Jason | P0 |
| Hero — 4 KPI | derived from /sources + /meta | `sources.filter(live).length`, `formalOrder.state` | NONE | Both /sources and /meta missing | See /sources and /meta rows | Jason | P0 |
| Data source status | GET /api/v1/sources | `SourceStatus[8]{key,name,short,desc,status,lastUpdateAt,updated,note,stalenessMinutes,days?,detail,cta?}` | NONE | DOES NOT EXIST | 8-source normalized status list not exposed; /api/v1/data-sources/finmind/status exists but only for FinMind, different schema, uses uppercase enums (LIVE_READY not "live") | Jason | P0 |
| Freshness timeline | (from /sources.lastUpdateAt) | `SourceStatus[].lastUpdateAt` ISO+08:00 | NONE | blocked by /sources missing | — | Jason | P0 |
| Source detail drawer | GET /api/v1/sources/{key} | `SourceDetail{...SourceStatus, events[]}` | NONE | DOES NOT EXIST | — | Jason | P1 |
| Company heatmap | GET /api/v1/heatmap | `{sourceState, tiles:[{sym,name,pct,mcap}]}` | NONE | DOES NOT EXIST | market-data/overview returns heatmap[] internally but different shape; no mcap field; no sourceState wrapper; not at /api/v1/heatmap | Jason | P0 |
| FinMind health | GET /api/v1/finmind/health | `{sponsor,tokenPresent,quotaTotal,quotaUsed,datasets:{ok,downgraded,blocked},recentRequest,requests[5]}` | /api/v1/data-sources/finmind/status | PARTIAL MISMATCH | IUF returns rich internal shape but: (a) endpoint path differs, (b) no `sponsor` field, (c) no `quotaTotal`/`quotaUsed` ints — quota is tier-based, (d) no `requests[]` last-5 log, (e) no `recentRequest` object | Jason | P1 |
| OpenAlice status | GET /api/v1/openalice/status | `{runner:{state,lastHeartbeat}, dispatcher:{state,lastScan}, queue:{queued,running,review}, publishedToday, sourceTrail:{complete,missing[]}, aiReview:{state,waiting,note}, pipeline[5], notice}` | /api/v1/openalice/observability | DOES NOT EXIST as /status | observability returns {workerStatus,sweepStatus,workerHeartbeatAt,lastSweepAt,metrics:{queuedJobs,runningJobs...}} + pipeline addendum; missing: `runner/dispatcher` named objects with `state` key matching vendor spec, `publishedToday`, `sourceTrail`, `aiReview`, normalized `pipeline[5]` with id/name/state/note | Jason | P0 |
| Paper E2E 6-stage | GET /api/v1/paper/e2e | `PaperStep[6]{id,name,desc,state,count,note}` | NONE | DOES NOT EXIST | /api/v1/paper/health/detail exists (internal health probe); /paper/portfolio and /paper/fills exist but return raw position data, not 6-stage pipeline shape | Jason | P0 |
| Portfolio preview | GET /api/v1/portfolio/preview | `{cash,positions,readiness:"preview-only",note}` | /api/v1/paper/portfolio | SHAPE MISMATCH | /paper/portfolio returns `{data:[{symbol,netQtyShares,avgCostPerShare,fillCount,note}]}` — array of positions, not summary; missing cash balance, readiness field, summary note | Jason | P1 |
| Strategy candidates | GET /api/v1/strategy/ideas | `StrategyIdea[]{sym,name,stance,confidence(0-100),gate,reason}` | /api/v1/strategy/ideas | SHAPE MISMATCH | IUF returns `{data:[{companyId,symbol,companyName,confidence(0-1),direction,...}]}`; missing: `sym` alias (uses `symbol`), `name` alias (uses `companyName`), `stance` field entirely absent, `gate` field entirely absent, `reason` absent, confidence is 0-1 not 0-100 | Jason | P1 |
| Dashboard snapshot | GET /api/v1/dashboard/snapshot | Aggregated all panels | NONE | DOES NOT EXIST | — | Jason | P1 (blocked by P0s) |
| Workflow today | GET /api/v1/workflow/today | `WorkflowItem[5]{id,title,desc,cta,state,href}` | NONE | DOES NOT EXIST | — | Jason | P2 |
| Blocked panel | GET /api/v1/blocked | `BlockedItem[4]{name,why,next,icon}` | NONE | DOES NOT EXIST | — | Jason | P2 |

---

## Summary counts

| Priority | Count |
|---|---|
| P0 — blocking render | 8 endpoints |
| P1 — partial / shape mismatch | 5 endpoints |
| P2 — low-priority panels | 2 endpoints |

---

## P0 blockers (dashboard cannot render without these)

1. `GET /api/v1/quotes` — does not exist; closest is `/market-data/overview` (wrong shape)
2. `GET /api/v1/meta` — does not exist
3. `GET /api/v1/breadth` — does not exist at that path
4. `GET /api/v1/sources` — does not exist (8-source normalized list)
5. `GET /api/v1/heatmap` — does not exist at that path
6. `GET /api/v1/openalice/status` — does not exist at that path + shape mismatch
7. `GET /api/v1/paper/e2e` — does not exist
8. `intradayTwii` 60-point array — not computed anywhere in IUF today

---

## Safe fallbacks (vendor spec says these are OK)

- `/api/v1/sources/{key}` detail drawer — on-click only, can ship P1
- `/api/v1/dashboard/snapshot` — aggregate; can ship after all sub-endpoints exist
- `/api/v1/workflow/today` and `/api/v1/blocked` — P2 panels; dashboard renders without them

---

## Status rules note

Vendor `SourceState` enum uses lowercase (`live/stale/empty/blocked/error/review`).
IUF `/data-sources/finmind/status` uses uppercase (`LIVE_READY/DEGRADED/BLOCKED`).
These are incompatible — Jason must bridge or normalize at the new `/api/v1/sources` endpoint.

---

## Verdict

CANNOT DEPLOY vendor frontend against current IUF backend.
8 P0 endpoints are missing or have incompatible shapes.
No vendor panel will render correctly on first load.
Recommend Jason build new thin endpoints at the vendor-spec paths, backed by existing IUF data stores.
Do NOT route vendor Codex page.tsx against existing `/market-data/overview` or `/openalice/observability` — shapes are incompatible.
