# K-line Incident Root Cause — 2026-05-05

**Triggered by:** 楊董 ~21:07 TST 5/5 「我原本網站的 k 線呢全都不見了 finmind 數據都沒了 openalice 4/22 推上去的」
**Investigator:** Elva (PowerShell live probe, no Bash)
**Verdict:** **NOT a chart component bug — entire ETL/scheduler died 4/25-4/29; nobody noticed for 6-10 days.**

---

## §1 Live probe results (prod, authenticated qazabc159)

| Endpoint | Status | Key finding |
|---|---|---|
| `/api/v1/companies/2330/kbar?freq=1d` | 200 | `state=EMPTY, source=FINMIND, date=2026-04-29, requestedDate=2026-05-05, rows=[]` |
| `/api/v1/companies/2330/kbar?freq=1m` | 200 | same EMPTY since 2026-04-29 |
| `/api/v1/companies/2330/ohlcv` | 200 | **all entries `source=mock`, range 2025-07-29~** |
| `/api/v1/companies/ohlcv/bulk?ids=2330` | 200 | same mock data |
| `/api/v1/diagnostics/finmind` | 200 | `ohlcvSource=mock, requestCount=0, lastFetchTs=null` ← **smoking gun** |
| `/api/v1/data-sources/finmind/status` | 200 | `state=LIVE_READY, tokenPresent=true` (false signal) |
| `/api/v1/briefs` | 200 | latest `date=2026-04-25` (10 days stale) |
| `/api/v1/openalice/observability` | 200 | `workerStatus=healthy, queuedJobs=0, terminalJobs=531` |
| `/api/v1/openalice/jobs?status=draft_ready` | 200 | all jobs are `[P0E round-trip proof]` test residue |
| `/api/v1/content-drafts?status=awaiting_review` | 200 | all drafts trace back to P0E test jobs |

---

## §2 Root cause stack

**A. Frontend K-line element NOT broken.** `OhlcvCandlestickChart.tsx` + 12 sibling files in `apps/web/app/companies/[symbol]/` all present.

**B. Two independent failures dropping K-line on company page:**

1. **Prod env `OHLCV_SOURCE=mock`**: `/ohlcv` route returns mock data dated 2025-07. Violates **stop-line #7 (no mock pretending live)**. This was set since deploy and never flipped to `finmind`.
2. **DB kbar table frozen at 2026-04-29**: `/kbar` route reads from DB cache (proven by `requestCount=0` — backend never called FinMind API since process start). DB kbar ETL stopped writing rows after 4/29.

**C. OpenAlice scheduler stopped dispatching daily_brief jobs after 2026-04-25.** Worker heartbeat reports `healthy` (heartbeatAge=23s) but `queuedJobs=0` permanently. `terminalJobs=531` is historical P0E test residue from 4/22-4/25 era. Health probes look at heartbeat, not output — false healthy signal. **NEW stop-line #15 violation (K-line/data missing while reported healthy).**

**D. PR #182 「wire FinMind diagnostics dashboard」** created the dashboard panel but didn't wire `recordFinMindRequest()` into `finmind-client.ts`. server.ts:4347 comment confirms: `"Exported so finmind-client.ts could call it in the future; not wired yet"`. This is **cosmetic-PR-inflation** in literal form — UI panel exists, backend counter never increments, panel always shows requestCount=0 which staff read as "low traffic" instead of "never called".

---

## §3 Why nobody noticed for 6-10 days

- 4/25-5/5 team activity: 14 Codex cosmetic PRs / 4 round Jason paper_orders 5xx firefighting / 19+ Bruce deferred smoke (Bash dead) / Elva cascade-merge mode.
- No `production smoke` actually opened a browser or hit `/kbar` with auth.
- Health probes (`/health`, `/openalice/observability`) all green because they measure process aliveness, not data freshness.
- 5/2-5/3 PR #167 `polish company kline` switched frontend to `/kbar` real-data path; backstop `/ohlcv` mock route became invisible to UI but stayed live serving cached mock.
- No alert wired on `briefs.latest.date` or `kbar.latest.date` staleness.

---

## §4 Trade Capability Score impact

| Layer | Score | Note |
|---|---|---|
| K-line on company page | **-1** | Missing in prod, user-visible regression |
| Mock-pretending-live in `/ohlcv` | **-1** | stop-line #7 violation, latent risk if any frontend re-reads |
| OpenAlice daily brief pipeline | **-1** | 10 days no new brief, false-healthy worker |
| FinMind diagnostics panel (PR #182) | **0 → -1** | claimed +1, actually wrapper-only with broken counter |

Net 5/5 reopen pre-investigation: heavily negative once data trust is the metric.

---

## §5 Required fixes (P0, distinct lanes)

| # | Owner | Action | ETA |
|---|---|---|---|
| F1 | Jason | Set Railway env `OHLCV_SOURCE=finmind` (or remove mock branch entirely from `/ohlcv` route) | <30min |
| F2 | Jason | Audit kbar ETL cron — why 4/29 last write, restart loader | 1-2h |
| F3 | Jason | Audit OpenAlice daily_brief dispatcher cron — why 4/25 last dispatch | 1-2h |
| F4 | Jason | Wire `recordFinMindRequest()` into `finmind-client.ts` so `inProcess.requestCount` reflects real calls | <30min |
| F5 | Elva | After F1-F4 land, re-run this same probe and confirm `requestCount>0`, `kbar.date>=today-1`, `briefs.latest.date>=today-1` | live verify |
| F6 | Codex / Elva | Add `data_freshness` panel on `/dashboard`: red if `kbar.latest_date < today-2` or `briefs.latest_date < today-2` | <2h cosmetic-but-+1 |

**F6 = the kind of cosmetic PR that's actually +1**: surfaces real data correctness, not just label.

---

## §6 What stop-lines actually triggered (revised)

| Old stop-line | Triggered? | Evidence |
|---|---|---|
| #7 no mock/fake pretending live | **YES** | `/ohlcv` `source=mock` in prod |
| #11 no AI brief without source trail | partial | briefs are P0E test residue, current production has 0 new brief 10d |
| #15 K-line missing but reported healthy | **YES** | observability healthy + queuedJobs=0 + briefs 10d stale |

This is the first session where multiple stop-lines triggered concurrently and pre-incident audits showed all-green.

---

**Conclusion**: K-line incident is the visible tip of a 6-10 day silent ETL/scheduler outage. Frontend is innocent. Backend cron/ETL system is the patient. Fix lanes are independent and parallelizable. Estimate: full restoration <4h once Jason starts F1-F4.

Authored: Elva, 2026-05-05 (PowerShell live probe).
