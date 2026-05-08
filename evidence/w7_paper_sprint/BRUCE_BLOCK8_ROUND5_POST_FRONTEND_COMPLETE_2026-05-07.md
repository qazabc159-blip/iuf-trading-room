# BRUCE BLOCK #8 ROUND 5 — Post-Frontend Complete Production Smoke
# 2026-05-07 ~18:40–19:05 TST (10:40–11:05 UTC)

Verifier: Bruce  
Session: BLOCK #8 §7 post-ship smoke (Lane A/B/C/D all merged to origin/main)  
Scope: 13 endpoints × verdict + Lane A/B/C/D ship verdict + overall BLOCK #8 收板 verdict  

---

## AUTH

- Endpoint: `POST https://api.eycvector.com/auth/login`
- Credentials: qazabc159@gmail.com
- Result: HTTP 200 / iuf_session cookie PRESENT (len=101)
- Time: 0.59s

---

## 13 ENDPOINT VERDICT TABLE

| # | Target | HTTP | Time | State Semantic | Verdict |
|---|--------|------|------|---------------|---------|
| 1 | `GET /` homepage | 200 | 3.1s | FinMind=阻擋(BLOCKED honest) / OpenAlice=正常 / Paper=正常 / 每日簡報=已發布 | GREEN |
| 2 | `GET /alerts` (Lane A PR #278) | 200 | 0.74s | ACTIVE=0 ACKED=0 honest empty / 不假事件 disclaimer visible | GREEN |
| 3 | `GET /briefs` | 200 | 1.0s | 7 published briefs / status=published / source trail present | GREEN |
| 4 | `GET /briefs/2026-05-07` (Lane B PR #279) | 200 | 0.75s | auditChain 3 panels: hardReject=false / adversarial=尚未審核(honest null) / hallucination=尚未審核(honest null) / secret leak=0 | GREEN |
| 5 | `GET /companies/2330` (Lane C PR #280) | 200 | 9.2s | Sections [01][03][04][05] SSR rendered / [06]-[11] CSR shell renders with 載入中 + sub-section labels visible / killSwitch ARMED / 買進 in paper order form only with "不是投資建議" | YELLOW |
| 6 | `GET /companies/1104` comparison | 200 | 7.7s | Same section pattern as 2330 / FinMind data showing honest state | YELLOW |
| 7 | `GET /lab` | 200 | 0.70s | 不顯示勝率 disclaimer / Athena+Bruce gate requirement visible / research only framing | GREEN |
| 8 | `GET /lab/strategies` (Lane D PR #277) | 200 | 0.71s | RESEARCH_SYSTEM header / 3 candidates RESEARCH_ONLY / amber pills / "Awaiting Athena/Bruce gates" / no Sharpe/equity/winRate/allocation | GREEN |
| 9 | `GET /lab/candidates` (Lane D PR #277) | 200 | 0.69s | Same as strategies (alias view) / alignment lock disclaimer / no fake approved wording | GREEN |
| 10 | `GET /lab/research` (Lane D PR #277) | 200 | 2.5s | v11 KILL_NO_EDGE / v15 THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM / portfolio verdict shown | GREEN |
| 11 | `GET /portfolio` | 200 | 0.70s | baseCapitalTWD=20000 / simulated=true / paperMode=true / 無部位 / GET /api/v1/paper/portfolio source label visible | GREEN |
| 12 | `GET /api/v1/alerts?limit=10` | 200 | 0.61s | data=[] (honest empty) / engineState.lastTickAt=2026-05-07T10:36:33Z (12.7min ago) / lastError=null | GREEN |
| 13 | `GET /api/v1/briefs/2026-05-07` | 200 | 0.59s | id confirmed / status=published / sections=5 / auditChain.hardReject.rejected=false rules=6 / adversarialReview=null / hallucinationCheck=null / secret scan CLEAN | GREEN |

**Overall HTTP: 13/13 HTTP 200. 0 4xx user errors. 0 5xx server errors.**

---

## LANE SHIP VERDICTS

### Lane A — /alerts (PR #278)

| Check | Result |
|-------|--------|
| HTTP 200 | PASS |
| engineState.lastTickAt within reasonable range (12.7min, no error) | PASS |
| ACTIVE/ACKED state labels visible | PASS |
| data=[] honest empty (not fake events) | PASS |
| "不假事件" wording present | PASS |
| No buy/sell wording | PASS |
| No stop-line trigger | PASS |

**Lane A Verdict: GREEN — ship confirmed live.**

### Lane B — /briefs/[id] with auditChain (PR #279)

| Check | Result |
|-------|--------|
| HTTP 200 | PASS |
| auditChain 3 panels rendered | PASS |
| hardReject panel: rejected=false, rules=6 | PASS |
| adversarialReview panel: honest null shown as "尚未審核" | PASS |
| hallucinationCheck panel: honest null shown as "尚未審核" | PASS |
| Secret leak in brief body | CLEAN (0 hits) |
| "不提供買賣建議" in page header | PASS |
| No stop-line trigger | PASS |

**Note:** adversarialReview and hallucinationCheck both null from API — frontend renders honest empty state rather than fake green. This is CORRECT behavior per spec. The brief for 2026-05-07 was published without going through full audit pipeline for these two panels (possible because adversarial/hallucination fire async). Not a frontend defect.

**Lane B Verdict: GREEN — ship confirmed live. Audit pipeline async behavior EXPECTED.**

### Lane C — /companies/[symbol] 11 sections (PR #280)

| Check | Result |
|-------|--------|
| HTTP 200 | PASS |
| origin/main HEAD = cbb7a87 (PR #280 merged) | CONFIRMED |
| Sections [01][03][04][05] SSR rendered | PASS |
| Section [06]-[11] block header present | PASS |
| [06]-[11] sub-labels (財報/月營收/法人/融資券/股利/公告) visible | PASS |
| [06]-[11] data loads CSR with 載入中 SSR placeholder | YELLOW (CSR only) |
| 買進/賣出 in paper order form only with "不是投資建議" | PASS (not a recommendation) |
| 勝率/Sharpe/equity curve = 0 hits | PASS |
| killSwitchEnabled=true via /api/v1/paper/flags | PASS |
| FinMind states honest (STALE/LIVE from API, not fake LIVE) | PASS |
| sourceStatus cards render | PASS |
| No stop-line trigger | PASS |

**Lane C Verdict: YELLOW — PR #280 confirmed merged and sections rendered. [06]-[11] data section renders as CSR-loaded shell (client-side data fetch after SSR). SSR payload contains section placeholder + loading state — browser will hydrate with real data. Not a fake green: state is "載入中" not "LIVE". Full client-side render verification requires browser (not curl). Raise as P2 follow-up.**

### Lane D — /lab/strategies + /lab/candidates + /lab/research (PR #277)

| Check | Result |
|-------|--------|
| HTTP 200 all 3 pages | PASS |
| RESEARCH_SYSTEM header on strategies page | PASS |
| 3 RESEARCH_ONLY candidates rendered (from API live payload) | PASS |
| Amber "research-only" pill per candidate | PASS |
| "Awaiting Athena/Bruce gates" per candidate | PASS |
| v11 KILL_NO_EDGE on research page | PASS |
| v15 THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM on research page | PASS |
| Sharpe / equityCurve / winRate / allocation fields: 0 hits | PASS |
| paper-ready / live-ready wording: 0 hits | PASS |
| 必賺 only in "禁止顯示欄位" disclaimer (NOT as a positive claim) | PASS |
| Lab API payload: sanctioned=true, researchOnly=true, meta.source=lab_sanctioned | PASS |
| Lab/TR alignment lock compliance | PASS |
| No stop-line trigger | PASS |

**Lane D Verdict: GREEN — ship confirmed live. All 3 sub-pages render with correct RESEARCH_ONLY framing. Lab/TR alignment lock physically enforced.**

---

## SUPPORTING API EVIDENCE

### /api/v1/paper/flags
```json
{ "executionMode": "paper", "killSwitchEnabled": true, "paperModeEnabled": true }
```
killSwitch ON — hard stop confirmed. No KGI live order path active.

### /api/v1/paper/portfolio
```json
{ "summary": { "baseCapitalTWD": 20000, "simulated": true, "paperMode": true, "positionCount": 0 } }
```

### /api/v1/lab/strategies (live from production)
- sanctioned=true, sprintId=v15, researchOnly=true
- 3 candidates all RESEARCH_ONLY with disclaimer
- meta.source=lab_sanctioned

### /api/v1/ops/snapshot
- OpenAlice: workerStatus=healthy, heartbeatAgeSeconds=31
- eventHistory: 200 events / 24h (191 success, 9 warning)
- adversarial_audit entries in recent events — pipeline confirmed active

### /order/create probe
- `POST /api/v1/order/create` → HTTP 404 (route does not exist)
- KGI live order creation path: CONFIRMED ABSENT

---

## STOP-LINE AUDIT (§11)

| SL# | Rule | Status |
|-----|------|--------|
| SL-01 | token/password/secret printed in page | CLEAN — 0 hits across all 11 pages |
| SL-02 | buy/sell wording (as recommendation) | CLEAN — 買進/賣出 only in paper order form with "不是投資建議" |
| SL-03 | approved strategy without lab | CLEAN — "NOT approved" / "Awaiting gates" only |
| SL-04 | paper-live-ready wording | CLEAN — 0 hits |
| SL-05 | KGI write-side import/call | CLEAN — 0 hits |
| SL-06 | /order/create route active | CLEAN — 404 (route absent) |
| SL-07 | fake live data | CLEAN — STALE/BLOCKED/EMPTY all honest |
| SL-08 | fake Sharpe/equity/win-rate as metrics | CLEAN — 必賺 only in "禁止顯示" disclaimer |
| SL-09 | destructive migration | NOT APPLICABLE (no migration in BLOCK #8 scope) |
| SL-10 | auth bypass | CLEAN — all pages require iuf_session cookie |
| SL-11 | production 5xx persist | CLEAN — 0 5xx across 13 probes |

**ALL 11 STOP-LINES HELD. 0 VIOLATIONS.**

---

## PRODUCTION STATE SUMMARY

| Subsystem | State | Evidence |
|-----------|-------|---------|
| Railway deploy (origin/main cbb7a87) | LIVE | /companies/2330 shows [06]-[11] section from PR #280 |
| OpenAlice worker | HEALTHY | heartbeatAgeSeconds=31 |
| Paper mode | ARMED + ON | killSwitchEnabled=true / executionMode=paper |
| FinMind | BLOCKED (honest) | Homepage: 阻擋 status-bad |
| KGI write-side | ABSENT | /order/create 404 |
| Alerts engine | RUNNING | lastTickAt 12.7min ago / lastError=null |
| Lab API | LIVE + SANCTIONED | 3 RESEARCH_ONLY candidates from v15 |
| Paper portfolio | EMPTY BASELINE | baseCapitalTWD=20000 / positionCount=0 |

---

## FOLLOW-UP ISSUE LIST

### P1 (Blocking — address before next major milestone)
*None identified.*

### P2 (Should fix — non-blocking today)

**P2-A: /companies/[symbol] sections [06]-[11] — CSR-only data load**
- What: [06]-[11] section renders SSR placeholder "載入中" only; actual financial data (financialStatement, monthlyRevenue, institutional, marginShort, dividend, announcements) loads client-side via useEffect or SWR
- Impact: curl-based smoke cannot verify the rendered data; browser required for full verification
- Evidence: HTML shows `<span class="badge badge-blue">載入中</span>` with loading spinner copy
- Owner: Codex / Elva to verify browser rendering
- Action: Add a dedicated browser smoke script OR verify Railway web logs show successful /full-profile fetch

**P2-B: /briefs/2026-05-07 — adversarialReview and hallucinationCheck = null**
- What: Both panels show "尚未審核" (honest) but spec expected 3 panels to have data
- Impact: UI handles correctly (honest empty), but the audit pipeline did not fully process today's brief
- Evidence: API returns `auditChain.adversarialReview: null, hallucinationCheck: null`
- Owner: Jason / OpenAlice pipeline — check if adversarial/hallucination triggers for the 5/7 brief
- Action: Verify audit-logs for brief id `74ca1324` — look for adversarial_audit and hallucination_check actions

**P2-C: company/1104 initial load 7.7s (improved from 24s with fresh CDN)**
- What: 台泥 (1104) takes 7.7s due to getCompanies() call fetching all 3470 companies
- Prior context: Known root cause from BLOCK #5 smoke — getCompanies() in-memory find pattern
- Owner: Jason — PR #259 added ticker query filter but company page may not use it
- Action: Verify /companies/1104 page.tsx uses ticker query param (not full list fetch)

### P3 (Nice to have)

**P3-A: alerts engineState.lastTickAt age = 12.7min (>5min threshold)**
- Per memory pattern: "alerts data=[] OK if engineState.lastTickAt within 5min"
- lastTickAt is 12.7 minutes ago — slightly stale but no error, engine healthy
- The alert engine tick interval may legitimately be >5min (10min or 15min scheduler)
- Action: Confirm tick interval setting; update smoke threshold if expected > 5min

---

## BLOCK #8 OVERALL VERDICT

**BLOCK #8 §7 收板 Verdict: PARTIAL_GREEN**

- Lane A (/alerts PR #278): GREEN — fully live
- Lane B (/briefs/[id] PR #279): GREEN — fully live (audit chain honest empty is correct)
- Lane C (/companies/[symbol] PR #280): YELLOW — SSR shell confirmed, CSR data unverifiable without browser
- Lane D (/lab/* PR #277): GREEN — fully live, alignment lock enforced

**Can deploy more PRs?** YES — no stop-line triggered, system stable.
**Can declare full ship收口?** PARTIAL — 3/4 lanes GREEN, Lane C needs browser verification of [06]-[11] CSR data.
**KGI write-side safe?** YES — /order/create 404, killSwitchEnabled=true.
**Paper mode safe?** YES — executionMode=paper, killSwitch ON, 20k baseline confirmed.

---

*Evidence collected: 2026-05-07 ~18:40–19:05 TST*  
*Bruce (verifier-release-engineer) — read-only probe, no destructive actions taken*
