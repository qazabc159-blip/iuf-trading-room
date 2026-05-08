---
session: BLOCK #7 Round 4 Frontend Smoke — Codex Ship Detection
date: 2026-05-07
verifier: Bruce
scope: 5-page frontend walk-through; Codex letter A/B/C/D surface detection; new content delta vs Round 3
auth: qazabc159@gmail.com (Owner) — iuf_session cookie confirmed
time: ~15:35-15:45 TST
---

# BRUCE BLOCK #7 ROUND 4 — FRONTEND SMOKE REPORT
# 2026-05-07 TST ~15:45
# Purpose: Detect what Codex shipped but we may have missed

---

## Auth Gate

POST https://api.eycvector.com/auth/login
Result: HTTP 200 / user.role=Owner
Verdict: GREEN

---

## Page 1 — Homepage ( https://app.eycvector.com/ )

body_len: 51,508 bytes (Round 3 was 49,367 → delta +2,141 bytes)

### Content confirmed present:
- H1: 台股 AI 交易戰情室
- H2: 把散亂資訊變成可驗證、可風控、可執行的交易流程。
- H2: 今日市場定調
- H3: 主題觀察：AI 光通訊 / CPO
- FinMind status section: quota 1,507/6,000 / 台股新聞 LIVE 75 rows (2026-05-07 07:30)
- OpenAlice status: Runner healthy / Dispatcher healthy / Queue 752
- Brief published: 2026-05-07 / 5 sections
- Paper health: Preview=阻擋, 送出=Gate 鎖定, Queue=0
- Nav: 策略想法 / 候選清單 / 策略批次 / 批次紀錄 (menu items visible)

### New content vs Round 3:
- FinMind news count now shows LIVE 75 rows (was 0 in Round 3)
- Homepage body +2,141 bytes — minor content update (likely FinMind dataset state text expansion)
- No new top-level sections added (no research candidates / alert center / event timeline section)
- Nav link to /lab exists (1 hit)

### Codex letter signals on homepage:
- Research candidates section: NOT PRESENT (no dedicated block)
- Alert center: NOT PRESENT (no /alerts link, no alert-center section)
- OpenAlice quality stamp: NOT PRESENT as distinct UI element; source trail mentioned in brief preview text
- Event timeline: NOT PRESENT

Verdict: GREEN (core cockpit) / MISSING for letter A/C/D specific homepage sections

---

## Page 2 — /lab & /lab/strategies ( Letter A )

### /lab — 量化研究 page
- HTTP: 200 | body_len: 14,551 bytes
- H1: 量化研究
- H2: 先收正式策略包，再談績效曲線。
- Content: "目前模式 資料待接 / 量化策略包 API 尚未接上"
- Strategy counts shown: 總包數 -- / 待審 -- / 已核准 -- / 已退回 -- / 已送出 --
- Governance boundary text present: 不會實單 / 只讀展示 / 禁止動作明列

### /lab/strategies
- HTTP: 200 | body_len: 14,066 bytes
- H1: 量化策略包明細
- State: 暫停 — 策略包 strategies 的資料尚未啟用; 登入狀態已失效，請重新登入

### /lab/candidates
- HTTP: 200 | body_len: 14,066 bytes
- State: 暫停 — 策略包 candidates 的資料尚未啟用

### /lab/research
- HTTP: 200 | body_len: 14,056 bytes
- State: 暫停 — 策略包 research 的資料尚未啟用

### /strategies
- HTTP: 404 — route does not exist

### API check:
- GET /api/v1/lab/strategies → 404
- GET /api/v1/strategies → 404

### Codex Letter A verdict: PARTIAL
- Pages /lab /lab/strategies /lab/candidates /lab/research all render (HTTP 200) with correct governance text
- Strategy data endpoint not wired — all pages show 暫停 / 資料待接
- No real RESEARCH_SYSTEM display (no Athena bundle ingested)
- Hard requirement satisfied: no fake strategy counts, no fake Sharpe, no equity curves
- Auth cookie state issue detected: pages show "登入狀態已失效" despite valid session — possible SSR cookie forwarding issue on /lab/* sub-routes

---

## Page 3 — /companies/2330 ( Letter B — 11 dataset render )

body_len: 909,607 bytes (Round 3 was 60,596 → delta +849,011 bytes — massive data expansion)

### Dataset sections rendered:
| Section | Label | State |
|---------|-------|-------|
| [01] | 公司主檔 / 公司資料庫 / 產業分類 / 驗證狀態 | PRESENT |
| [03] | 財報與估值 / FinMind：財報 / 月營收 / 資產負債 / 現金流 / PER / 市值 / 股利 | PRESENT |
| [04] | 籌碼流向 / FinMind 三大法人 / 融資券 | PRESENT (載入中) |
| [05] | 重大訊息 / 臺股公告 / 新聞線索 | PRESENT (載入中) |
| 衍生品 | 權證與選擇權 | PRESENT (待正式資料 / 暫停) |
| 逐筆 | 盤中報價 | PRESENT (等待 KGI 唯讀資料) |
| 資料狀態 | 來源狀態 LIVE/EMPTY/BLOCKED | PRESENT |

### Dataset [06]-[11] check:
- Sections [06] through [11]: 0 hits — not yet rendered in page
- Missing sections likely: [02] price detail / [06] dividends / [07] market cap / [08] shareholding / [09] margin trading / [10] news / [11] announcements detail

### Full-profile API dataset states (confirmed live):
- fundamentals.monthlyRevenue: STALE (11 rows)
- fundamentals.financialStatement: STALE (80 rows)
- fundamentals.cashFlow: STALE (80 rows)
- fundamentals.balanceSheet: STALE (80 rows)
- tradingFlow.institutional: LIVE (21 rows)
- tradingFlow.marginShort: LIVE (21 rows)
- tradingFlow.shareholding: LIVE (30 rows)
- marketIntel.dividend: LIVE (10 rows)
- marketIntel.marketValue: LIVE (30 rows)
- marketIntel.valuation: LIVE (21 rows)
- marketIntel.news: LIVE (17 rows) *** NEW vs Round 3 (was EMPTY circuit-open) ***

### NEWS state flip confirmed:
- Round 3: news.state=EMPTY (TaiwanStockNews circuit breaker open)
- Round 4: news.state=LIVE / 17 rows / latest 2026-05-06 23:23
- Circuit breaker self-healed (30min window passed + end_date fix deployed or circuit expired)

### Codex Letter B verdict: PARTIAL
- Company page renders with large dataset expansion (849KB of data now SSR'd)
- [01][03][04][05] sections present with correct labels
- [06]-[11] sections NOT yet rendered on page (API data exists but frontend sections missing)
- Page body 909KB — K-line, financials, chip flow, market intel all in SSR payload
- Homepage 投資作業系統 flow: visible in homepage text (brief/openalice/paper/market data flow)

---

## Page 4 — /alerts ( Letter C )

GET /alerts → HTTP: 404
GET /alert-center → HTTP: 404
GET /signals → HTTP: 200

### /signals page (存在的相近 route):
- body_len: 25,030 bytes
- H1: 訊號證據
- Content: 訊號流 / 5 signals total (偏多×5) / 最後更新 04/21 12:03 (16 days stale)
- Signal examples: 矽晶圓供給轉緊 / AI CoWoS 需求 / 先進封裝
- Source: 訊號資料庫

### Codex Letter C verdict: MISSING
- /alerts does not exist (HTTP 404)
- /alert-center does not exist (HTTP 404)
- /signals exists but is the "signal evidence" page, not an alert center
- No event timeline page found
- Alert center page with live alerts from OpenAlice/FinMind circuit: NOT SHIPPED

---

## Page 5 — /briefs + brief detail ( Letter D — adversarial / hallucination quality stamp )

### /briefs page
- HTTP: 200 | body_len: 44,972 bytes
- Total text: 5,076 chars (after tag stripping)
- "source trail" mentions: 12 hits — confirmed present in page
- "AI 審核": present in page subtitle ("OpenAlice 自動產生、AI 審核與 source trail")
- Draft queue: 2 drafts pending review
- Brief content: 2026-05-07 published, 5 sections visible inline

### Brief detail page:
- GET /briefs/74ca1324-... → HTTP: 404
- GET /briefs/2026-05-07 → HTTP: 404
- GET /brief/2026-05-07 → HTTP: 404
- No brief detail route found — brief content rendered inline in /briefs listing page

### Brief object structure (API):
- keys: id / date / marketState / sections / generatedBy / status / createdAt
- sections[0] keys: body / heading (only 2 fields)
- No adversarialCheck / hallucinationCheck / qualityStamp / aiVerdict field in API response

### content-drafts structure:
- keys include: reviewedBy / reviewedAt / rejectReason / approvedRefId
- No adversarial/hallucination dedicated field found

### Codex Letter D verdict: MISSING
- No dedicated brief detail page (/briefs/<id> or /briefs/<date> both 404)
- No adversarial check / hallucination quality stamp field in brief API object
- "AI 審核" text present in page title/description but as label text, not as a computed quality indicator
- source trail present as concept but no stamp UI element with pass/fail status

---

## New Pages Discovered (not in Round 3)

| Route | HTTP | Content |
|-------|------|---------|
| /lab | 200 | 量化研究 hub — 策略包收件台 |
| /lab/strategies | 200 | 量化策略包明細 (資料暫停) |
| /lab/research | 200 | 量化策略包明細 (資料暫停) |
| /lab/candidates | 200 | 量化策略包明細 (資料暫停) |
| /signals | 200 | 訊號證據 / 5 signals / 16-day stale |

All /lab/* pages were NOT probed in Round 3 — these are Codex-shipped pages.

---

## Codex 4 Letter Summary

| Letter | Target | Route | State | Evidence |
|--------|--------|-------|-------|----------|
| A | Lab RESEARCH_SYSTEM display | /lab /lab/strategies | PARTIAL | Pages render HTTP 200, correct governance text, no fake data; API not wired (404), all show 資料暫停 |
| B | 公司頁 11 dataset render + homepage flow | /companies/2330 | PARTIAL | 4/11 sections rendered ([01][03][04][05]); [06]-[11] missing; huge data expansion confirmed; homepage flow text present |
| C | Alert center page | /alerts | MISSING | HTTP 404; no alert-center route; /signals exists but different scope |
| D | Brief detail with adversarial/hallucination stamp | /briefs/<id> | MISSING | No brief detail route; API object has no adversarial fields; source trail present as text but no quality stamp UI |

---

## Material Change vs Round 3

1. NEWS STATE FLIP: marketIntel.news 2330 flipped EMPTY → LIVE (17 rows) — TaiwanStockNews circuit expired/fixed
2. Company page body: +849KB — full dataset SSR expansion deployed (Codex letter B partial complete)
3. /lab /lab/strategies /lab/research /lab/candidates: new routes shipping — governance framework correct
4. Homepage: +2,141 bytes — minor update (FinMind news count now visible)
5. /signals: page exists with 5 real signals (stale but real data)

---

## Overall Frontend Completion Estimate

| Axis | Completion | Notes |
|------|-----------|-------|
| Homepage cockpit | 85% | Core sections present; no alert center / event timeline |
| Company page data | 45% | 4 of 11 dataset sections rendered; API has all data |
| Lab / Strategy | 30% | Pages exist with governance; API not wired |
| Alerts / Signal center | 10% | /signals exists stale; /alerts missing |
| Brief quality stamp | 20% | source trail concept present; no adversarial stamp field or detail page |
| **Overall frontend** | **~40%** | Core cockpit GREEN; 3 of 4 Codex letters incomplete |

---

## Stop-Lines Triggered: 0
## Write-Side Actions: 0
## KGI Interactions: 0

---

## Follow-Up Issues

### ISSUE-1 [YELLOW / Codex letter B]
Company page sections [06]-[11] not yet rendered.
- API has data: dividend LIVE / marketValue LIVE / valuation LIVE / shareholding LIVE / marginShort LIVE
- Frontend sections for these datasets not present in page
- Fix owner: Codex (frontend)

### ISSUE-2 [YELLOW / Codex letter A]
/lab/* pages show "登入狀態已失效" despite valid Owner session.
- Same SSR cookie-forwarding pattern as was fixed for portfolio/briefs (PR #255)
- Fix owner: Codex (frontend) — SSR cookie forward for /lab/* routes

### ISSUE-3 [RED / Codex letter C]
/alerts route does not exist at all.
- Letter C not shipped
- Fix owner: Codex (needs new page + API wiring)

### ISSUE-4 [RED / Codex letter D]
Brief detail page does not exist; adversarial/hallucination quality stamp not in API schema.
- Letter D not shipped; requires both backend (new fields on brief object) and frontend (detail page)
- Fix owner: Jason (API schema) + Codex (frontend detail page)

### ISSUE-5 [GREEN note]
news.state 2330 LIVE (17 rows) — TaiwanStockNews circuit self-healed.
- Round 3 had this as YELLOW (circuit open, Jason fix needed)
- Now LIVE — circuit expired naturally (30min) or fix was deployed
- Not a blocker; note for Jason to confirm end_date fix status

---

## Can Deploy: N/A (read-only smoke)
## Can Declare BLOCK #7 Round 4 PASS: YES — scan complete, no stop-line triggers
## Missing Codex letters: A(PARTIAL) / B(PARTIAL) / C(MISSING) / D(MISSING)
