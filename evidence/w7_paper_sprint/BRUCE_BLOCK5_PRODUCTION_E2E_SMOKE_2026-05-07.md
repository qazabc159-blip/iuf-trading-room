# BLOCK #5 Production E2E Smoke — Bruce Evidence Bundle
**Date**: 2026-05-07T09:21 TST  
**Verifier**: Bruce  
**Scope**: https://app.eycvector.com 7-page walk-through  
**Auth**: Owner role (qazabc159@gmail.com) via iuf_session cookie  
**Deploy Info**: Railway asia-southeast1-eqsg3a / deploymentId=1b237cf3 / startedAt=2026-05-07T01:02:44Z  

---

## Session Baseline

| Check | Result |
|-------|--------|
| API /health | HTTP 200 — status=ok, uptime=584s |
| Auth /auth/login | HTTP 200 — role=Owner, workspace=primary-desk |
| Railway edge | railway-edge / asia-southeast1-eqsg3a |
| Commit | unknown (Railway does not pass commit SHA in this deployment) |

---

## 7-Page Verdict Table

| # | Page | Route | HTTP | Load Time | Verdict | State Semantic |
|---|------|-------|------|-----------|---------|----------------|
| 1 | 首頁 / Cockpit | `/` | 200 | 2.3s | YELLOW | Real data; FinMind=BLOCKED honest |
| 2 | 公司頁 (2330) | `/companies/2330` | 200 | 9.0s | YELLOW | 台積電 renders, 727 OHLCV bars, 9s is P1 perf issue |
| 3 | 每日簡報 | `/briefs` | 200 | 1.2s | GREEN | 7 briefs, 2026-05-07 published, 5 sections with body content |
| 4 | 重大訊息 | `/market-intel` | 200 | <1s | YELLOW | Page loads; announcements endpoint returns empty array |
| 5 | 主題板 | `/themes` | 200 | <1s | YELLOW | 25 themes load; 5 have broken names (ORPHAN/BROKEN/DEPRECATED) |
| 6 | 紙上交易室 | `/portfolio` | 200 | 0.8s | GREEN | EMPTY state honest — 20,000 TWD capital, simulated=true, no fake fills |
| 7 | 策略批次 | `/runs` | 200 | <1s | YELLOW | Page serves; strategy/runs API returns total=0, no runs exist |

---

## Page-by-Page Detail

### Page 1: 首頁 / Cockpit (`/`)
**Verdict: YELLOW**  
**Load**: 2.3s (< 3s threshold PASS)  
**State semantic**: Honest. RSC payload verified:

```
FinMind: BLOCKED (status-bad class) — token 缺少 / 配額 782/6000
OpenAlice: 正常 (status-ok)
每日簡報: 已發布 (status-ok) — 2026-05-07
Paper: 正常 (status-ok)
```

**FinMind dataset ribbon (live from RSC)**:
- OHLCV/KBar adj: 正常 · 24,217 筆 · 2026-05-06
- 月營收: 正常 · 199 筆 · 2026-05-01
- 損益表: 過期 · 1,660 筆 · 2026-03-31
- 資產負債表: 過期 · 5,629 筆 · 2026-03-31
- 現金流量表: 過期 · 2,916 筆 · 2026-03-31
- PER/PBR/殖利率: 降級 · 0 筆
- 三大法人: 無資料 · 0 筆
- 融資融券: 無資料 · 0 筆

**Issues**:
1. YELLOW-1: FinMind token 缺少 — state=BLOCKED honest but token missing means 12 datasets 等待回補. Root: Railway env var `FINMIND_TOKEN` not set or expired. Assign: Jason/Elva ops.
2. YELLOW-2: 市場資料總覽 = 無資料 — "可紙上預覽 0 / K線可用 -- / 最新報價 --" — no live tick after market close, expected but label is EMPTY not BLOCKED which is correct.
3. YELLOW-3: 量化研究 panel shows 候選想法=8 / 資料阻擋=8 / 批次=0 — all 8 ideas blocked, no runs. This is honest state not fake green.

**No fake data confirmed**: No mock prices, no fabricated stats, no hardcoded performance numbers.

---

### Page 2: 公司頁 2330 台積電 (`/companies/2330`)
**Verdict: YELLOW**  
**Load**: 9.0s (FAIL — > 3s threshold)  
**Root cause of 9s**: `page.tsx:156` calls `getCompanies()` → `/api/v1/companies` → returns all 3,470 companies (no filter) → 3.6s just for that call, then finds 2330 in-memory. No single-company-by-ticker API endpoint.

**Data confirmed present** (API-level):
- ticker: 2330, name: 台積電
- chainPosition: Semiconductors
- 727 OHLCV bars, date range 2023-05-08 to 2026-05-06, source=tej
- Sorted ascending (oldest first) — chart renderer must handle

**Source status cards** (from RSC HTML):
- 公司主檔: live
- K線: live (727 bars, tej source)
- 重大訊息: stale (expected — announcements API returns empty array currently)

**Issues**:
1. RED-P1: Page load = 9.0s — getCompanies() fetches all 3,470 rows to find one ticker. Need `GET /api/v1/companies?ticker=2330` or `GET /api/v1/companies/:ticker` bypass. Assign: Jason.
2. YELLOW-2: Announcements panel = stale/empty — /api/v1/companies/2330/announcements returns `{"data":[]}`. FinMind news ingestion not backfilled.
3. YELLOW-3: KBar (minute bars) state = no data — expected, KGI gateway not running. Label should be BLOCKED_NO_GATEWAY not stale; check ChipsPanel / TickStreamPanel show BLOCKED correctly.

**No fake data**: 台積電 renders 17 times in RSC, all from real API. No hardcoded price.

---

### Page 3: 每日簡報 (`/briefs`)
**Verdict: GREEN**  
**Load**: 1.2s  

**API data** (`/api/v1/briefs`):
- 7 briefs total, all status=published
- 2026-05-07 brief: 5 sections, total 2,087 chars of body content
- Full date range: 2026-04-24 through 2026-05-07
- All 7 briefs have non-empty body content (field is `body` not `content`)

**Sample 2026-05-07 brief section**:
- 今日市場定調: 整體盤勢偏向 Balanced，主軸仍是 AI 基礎建設與半導體升級鏈...
- 主題觀察：AI Optics / CPO: AI Optics 與 CPO 仍是中長期結構性主題...
- Mentions "[BROKEN-1]" and "[BROKEN-2]" theme labels — briefs honestly surface dirty theme data.

**Page HTML state labels**: 8x "published", 8x "已發布", 14x "正常" — no BLOCKED/EMPTY false positives.

**Issues**:
1. YELLOW-1: 2026-05-07 brief body mentions [BROKEN-1]/[BROKEN-2] in market analysis — these are real theme mapping issues surfaced in the brief copy, not a brief bug. Assign: Athena to clean theme registry.
2. YELLOW-2: No source trail visible in brief HTML — need to verify briefs page shows provenance links (not verifiable via curl, need browser).
3. (none blocking) 7 briefs for 7 trading days — cadence appears working.

---

### Page 4: 重大訊息 (`/market-intel`)
**Verdict: YELLOW**  
**Load**: <1s  

**API**: `GET /api/v1/companies/2330/announcements` → HTTP 200, `{"data":[]}` (empty)  
**Frontend**: market-intel page renders, calls getCompanyAnnouncements for up to 16 "selected" companies.

**Issues**:
1. YELLOW-1: Announcement ingestion not backfilled — TWSE OpenAPI route exists (server.ts:4909) but returns empty. FinMind news dataset shows "降級 · 0 筆". Page state should show EMPTY with honest reason.
2. YELLOW-2: Page also calls getCompanies() (full 3,470 load) to build the selected-company list. Same 3.6s overhead as company detail page.
3. YELLOW-3: Cannot verify mobile 390px layout from curl — screenshot required.

---

### Page 5: 主題板 (`/themes`)
**Verdict: YELLOW**  
**Load**: <1s  

**API** (`/api/v1/themes`):
- 25 themes total
- 5 with broken names:
  - [ORPHAN] AI Optics (->CPO)
  - [ORPHAN] Audit Trail Live Check
  - [BROKEN-2] To Fix
  - [BROKEN-1] To Fix
  - [DEPRECATED] Photoresist Test
- 20 legitimate themes (低軌衛星, 電動車, 資料中心, 磷化銦, 碳化矽, etc.)

**Page HTML state**: 6x "正常" — lifecycle/marketState tags render.

**Issues**:
1. YELLOW-1: 5 themes with [ORPHAN]/[BROKEN]/[DEPRECATED] prefix visible in production. `displayThemeName()` in page.tsx partially masks [ORPHAN] → "待歸檔：" but [BROKEN-1] and [DEPRECATED] pass through raw. Assign: Athena/Elva to clean theme registry (also needed for brief quality).
2. YELLOW-2: All 25 themes showing lifecycle=Discovery or Validation. No Expansion/Crowded/Distribution themes visible — may reflect actual market state or thin data population.
3. (non-blocking) Themes page HTML is 57KB — reasonable.

---

### Page 6: 紙上交易室 (`/portfolio`)
**Verdict: GREEN**  
**Load**: 0.8s  

**API data**:
```
GET /api/v1/paper/portfolio → HTTP 200
{
  "data": [],
  "summary": {
    "baseCapitalTWD": 20000,
    "currency": "TWD",
    "simulated": true,
    "paperMode": true,
    "positionCount": 0,
    "investedCostTWD": 0,
    "note": "empty_state: no filled orders yet; base capital available"
  }
}

GET /api/v1/paper/fills → HTTP 200, {"data":[]}
GET /api/v1/paper/orders → HTTP 200, list=0
```

**Page HTML confirms**: "沒有已成交的模擬委託，因此沒有紙上部位。這不是錯誤，也沒有補假資料。"

**North Star訴求驗證**:
- baseCapitalTWD=20,000 PASS (PR #257 default)
- simulated=true PASS
- paperMode=true PASS
- Empty state wording honest, not cosmetic PASS
- No fake fills / no mock positions PASS
- "前端鎖定" on submit (cockpit confirms: 送出=前端鎖定) PASS

**Issues**:
1. (non-blocking) Paper Preview shows BLOCKED on cockpit — "Preview 阻擋" — means the preview price call fails (no live KGI quote). This is correct blocking behavior, not a bug.
2. (none blocking)

---

### Page 7: 策略批次 (`/runs`)
**Verdict: YELLOW**  
**Load**: <1s  

**API**: `GET /api/v1/strategy/runs` → HTTP 200, `{"total":0,"items":[]}`  
**Page HTML**: 20KB — page serves. "量化研究" panel on cockpit shows 批次=0 which is honest.

**Issues**:
1. YELLOW-1: Zero strategy runs in production — no Athena bundle has been submitted/executed. Cockpit accurately shows 候選想法=8 / 資料阻擋=8 / 批次=0. This is the actual state.
2. YELLOW-2: /api/v1/ideas returns 404 — ideas route may have moved. Cockpit still shows 8 candidate ideas (from `/api/v1/strategy/ideas`?). Need to verify actual route.
3. YELLOW-3: Cannot verify runs page empty state wording without browser — curl returns 20KB but full render requires JS hydration.

---

## Overall BLOCK #5 Verdict

### Summary Scorecard

| Criterion | Result |
|-----------|--------|
| All 7 pages HTTP 200 | PASS |
| No page > 3s load | FAIL — /companies/2330 = 9.0s |
| State semantic honest (no fake green) | PASS |
| No blank panels with mock data | PASS |
| Paper mode correct (20k TWD / simulated) | PASS |
| Brief content real (not empty) | PASS |
| Mobile 390px no overflow | NOT_VERIFIED (curl cannot test layout) |
| Console errors | NOT_VERIFIED (curl cannot capture JS runtime errors) |

### Verdict: PARTIAL GREEN

The product is **not a half-finished website**. Evidence:

**What is real and working**:
- Auth, session, role system works
- 3,470 companies in database, correct schema shape
- 727 OHLCV bars for 2330 with real dates (2023–2026)
- 7 daily briefs published with real body content (2,087 chars for 5/7)
- Paper portfolio: correct defaults, honest empty state, no fake fills
- Homepage cockpit: 4 data panels with accurate state labels, no cosmetic green
- Themes: 25 themes render with lifecycle metadata
- Market-intel: page serves, honest empty state for announcements

**Blocking issues (follow-up PRs needed)**:

| ID | Severity | Issue | Owner | Suggested Fix |
|----|----------|-------|-------|---------------|
| B1 | P1 | /companies/2330 loads 9s — getCompanies() fetches all 3,470 to find one | Jason | Add GET /api/v1/companies?ticker=:ticker filter or /api/v1/companies/:ticker single-row endpoint |
| B2 | P1 | FinMind token missing — 12 datasets blocked / waiting backfill | Elva ops | Set FINMIND_TOKEN in Railway API service env |
| B3 | P2 | 5 theme names polluted ([BROKEN-1], [DEPRECATED]) visible in production | Athena | Clean theme registry; update displayThemeName() to mask remaining |
| B4 | P2 | Announcements ingestion empty — market-intel has no news data | Jason | Trigger FinMind news backfill or mark dataset as BLOCKED_NOT_BACKFILLED |
| B5 | P3 | Queue=719 in OpenAlice — large queue, check if dispatcher is stuck | Elva/Jason | Verify worker queue processing rate |
| B6 | P3 | strategy/runs = 0, ideas route 404 — quant lane not connected | Athena/Elva | Not a product bug; surface state |

### GREEN-able After:
- B1 (9s load) = P1 blocker for 北極星訴求 #11 ("網站像產品"). An 9-second page load is not product-ready.
- B2 (FinMind token) = P1 blocker for data completeness.
- B3, B4 = P2 cleanup.

**Can declare BLOCK #5 partial close**: Pages are real, states are honest, paper workflow works. The site is not "半成品" from a data-fake perspective — every panel shows real or BLOCKED with reason. But two P1 issues (9s load, missing token) prevent full GREEN.

---

## Screenshot Manifest (should capture)

| ID | Page | Capture Point | Priority |
|----|------|---------------|----------|
| SS-01 | `/` desktop 1365px | Full cockpit with FinMind=BLOCKED panel + dataset ribbon | P1 |
| SS-02 | `/` mobile 390px | Sidebar nav + 4 status panels above fold | P1 |
| SS-03 | `/companies/2330` desktop | HeroBar + OHLCV chart + K-line source status | P1 |
| SS-04 | `/companies/2330` desktop | ChipsPanel, AnnouncementsPanel, PaperOrderPanel | P1 |
| SS-05 | `/briefs` desktop | Brief list + 2026-05-07 body content expanded | P1 |
| SS-06 | `/portfolio` desktop | EMPTY state + 20,000 TWD caption + "不是錯誤" text | P1 |
| SS-07 | `/themes` desktop | 25 themes with ORPHAN/BROKEN names visible | P2 |
| SS-08 | `/market-intel` desktop | EMPTY announcements panel with honest reason | P2 |

Note: Screenshots require browser automation (Playwright/Puppeteer) or manual capture — not producible via curl. Recommend Codex or operator manual capture.

---

## Verification Commands (Reproducible)

```bash
COOKIE="iuf_session=<from /auth/login>"

# Auth
curl -X POST https://api.eycvector.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"qazabc159@gmail.com","password":"[REDACTED-OWNER-PW]"}'

# Company count
curl "https://api.eycvector.com/api/v1/companies?limit=1" -H "Cookie: $COOKIE"
# Expect: data array with 3470 items on uncapped call

# 2330 OHLCV bar count
curl "https://api.eycvector.com/api/v1/companies/2330/ohlcv?interval=1d" -H "Cookie: $COOKIE"
# Expect: 727 bars, latest dt=2026-05-06

# Brief quality
curl "https://api.eycvector.com/api/v1/briefs" -H "Cookie: $COOKIE"
# Expect: 7 entries, 2026-05-07 status=published, sections[0].body non-empty

# Paper portfolio defaults
curl "https://api.eycvector.com/api/v1/paper/portfolio" -H "Cookie: $COOKIE"
# Expect: baseCapitalTWD=20000, simulated=true, paperMode=true, positionCount=0

# FinMind status
curl "https://api.eycvector.com/api/v1/data-sources/finmind/status" -H "Cookie: $COOKIE"
# Expect: state=LIVE_READY, quotaTier=sponsor999, tokenPresent=false (BUG: token missing)
```

---

## Evidence Session Metadata
- Verification time: 2026-05-07T09:18–09:23 TST (approx 30min window)
- Method: HTTP curl + static source analysis, no browser
- Auth: read-only Owner role, no write operations performed
- Deploy: Railway asia-southeast1, API uptime ~10min at verification time (startedAt 01:02 TST)
- Not tested (requires browser): mobile 390px layout overflow, JS console errors, chart interactivity, PaperOrderPanel submit button state
