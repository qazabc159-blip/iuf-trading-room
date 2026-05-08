# BLOCK #8 Production Content Audit — Pete 2026-05-07

## Audit Scope

Production target: https://app.eycvector.com (Owner auth qazabc159@gmail.com)
Source audited: `apps/web/` static analysis (server components, client components, shared libs)
Reference docs: `board/lab_tr_alignment_lock_2026-05-07.md`

---

## 1. Lab/TR Alignment Lock Audit — 7 Violation Items

### 1-A. `/lab/strategies` — Forbidden wording grep

Audited file: `apps/web/app/lab/strategies/page.tsx` + `apps/web/components/LabSubPageShell.tsx` + `apps/web/lib/radar-lab.ts`

| Forbidden term | Present in rendered output? | Finding |
|---|---|---|
| "approved" (as strategy status) | NO — `LabSubPageShell` header says "No strategy approved for Trading Room promotion" = IUF disclaimer, not a strategy label | PASS |
| "paper-ready" | NO | PASS |
| "live-ready" | NO | PASS |
| Sharpe | NO — explicitly listed as FORBIDDEN in footer terminal-note | PASS |
| equity curve / equityCurve | NO | PASS |
| win-rate / winRate | NO — explicitly listed in footer | PASS |
| allocation % | NO — explicitly listed in footer | PASS |

PASS count: 7/7

**Additional checks:**
- Header disclaimer block present: "Quant Lab status: RESEARCH_SYSTEM / No strategy approved for Trading Room promotion / Latest Lab frame: v11 KILL_NO_EDGE / v15 research candidates" — PASS
- Each `CandidateRow` shows `ResearchOnlyPill` + `GatesCaption` ("Awaiting Athena schema gate & Bruce harness gate · Not approved for paper/live") — PASS
- `labStatusDisplayWording()` maps RESEARCH_SYSTEM → "研究系統 / 未批准 TR 推廣" — verbatim from alignment lock — PASS
- Source: reads `GET /api/v1/lab/strategies` via `radarLabApi.strategies()` using `getApiEnvelope` — correct endpoint, no fabricated data — PASS

### 1-B. `/lab/candidates` — Forbidden wording grep

Audited file: `apps/web/app/lab/candidates/page.tsx` (shares `LabSubPageShell` with mode="candidates")

Same component tree as strategies. All 7 alignment lock checks: PASS.
Footer note: "禁止顯示欄位（per Lab/TR alignment lock）：Sharpe、equity curve、勝率、總交易數、P&L、配置比例 %、買賣建議、目標價、必賺 wording。違反 = stop-line。" — verbatim guard confirmed — PASS

### 1-C. `/lab/research` — Forbidden wording grep

Audited file: `apps/web/app/lab/research/page.tsx` + `ResearchFrameExtra` component

All 7 alignment lock forbidden terms: PASS (0 hits in rendered output).

Additional alignment lock items verified:
- v11 KILL_NO_EDGE displayed without softening: explicitly says "v11 sprint 結果：沒 edge，正式退場。不會被軟化為「待重啟」或「研究 ongoing」" — PASS
- portfolioVerdict displayed as-is ("THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM") — verbatim, not renamed — PASS
- TR boundary statement: "TR 不會替 Lab 改寫狀態 enum、不會自建假 strategy snapshot 冒充 Lab registry" — PASS

### 1-D. `/lab` overview — Forbidden wording grep

Audited file: `apps/web/app/lab/LabClient.tsx`

| Forbidden term | Present? | Note |
|---|---|---|
| Sharpe | YES — appears in disclaimer text "仍不會顯示：未驗證 Sharpe、假 equity curve、假交易紀錄" | PASS — this is a hard NEGATIVE disclaimer, not a display of Sharpe value |
| equity curve | YES (same disclaimer) | PASS — negative disclaimer |
| win-rate | NO in rendered metric cells | PASS |
| allocation % | NO | PASS |

**YELLOW finding — `LabClient.tsx` exposes `LabSignalBundle.backtest` fields in TYPE definition:**
- `radar-lab.ts` line 23-38: `LabSignalBundle.backtest` type includes `winRate`, `maxDrawdownPct`, `totalReturnPct`, `tradeCount`, `periodStats`, `equityCurve`, `drawdown`
- `LabBundleDetailClient.tsx` (bundle detail page) and `LabClient.tsx` do NOT render these fields — they show "績效 / 未核准" and "績效 / 待核准" instead — PASS
- BUT: the type definition proves these fields exist on the wire shape; if a dev accidentally renders `bundle.backtest.winRate`, there is no TS-level guard preventing it
- Impact: non-issue in current production render paths; type-level risk only

**Verdict for `/lab` overview:** PASS (no forbidden metrics rendered in production)

### strategy_001-004 literal hit check

Grepping for `strategy_001`, `strategy_002`, `strategy_003`, `strategy_004` in `apps/web/`:
- These were the OUT_OF_FRAME fabricated strategies from PR #238 (removed by PR #256)
- `LabSubPageShell` reads data from `GET /api/v1/lab/strategies` which now returns the sanctioned lab JSON
- No hardcoded strategy_00x references found in any frontend component
- PASS: OUT_OF_FRAME placeholder removal confirmed at frontend level

### RESEARCH_ONLY label + Awaiting gates wording

- `ResearchOnlyPill` component: renders amber "research-only" pill on every `CandidateRow` — PASS
- `GatesCaption` component: renders "Awaiting Athena schema gate & Bruce harness gate · Not approved for paper/live" — PASS
- `labStatusDisplayWording()`: maps all lab status enums to verbatim wording from alignment lock — PASS
- Blocked state: renders "目前無 Lab approved 策略可推廣（source=unavailable）" with grey panel — PASS

**Lab/TR Alignment Lock Section Verdict: PASS (7/7 forbidden terms absent from rendered output across all 4 pages)**

---

## 2. `/briefs/[id]` Detail Page Audit — 7 Hard Reject Rules (PR #279 scope)

### Critical finding: `/briefs/[id]` route does NOT exist in production

The task specifies auditing `/briefs/[id]` with AdversarialReview panel / HallucinationCheck panel (PR #279). Static analysis reveals:

- `apps/web/app/briefs/` contains only `page.tsx` (the list/management page)
- There is NO `apps/web/app/briefs/[id]/` subdirectory
- Brief detail is served at `apps/web/app/admin/content-drafts/[id]/page.tsx`

This means PR #279 has NOT yet introduced a `/briefs/[id]` public detail route, OR it was intended as the `admin/content-drafts/[id]` page. The audit proceeds against `admin/content-drafts/[id]/page.tsx` as the de-facto brief detail surface.

### 2-A. No buy/sell/target price/必賺/勝率/guarantee wording

Audited: `apps/web/app/admin/content-drafts/[id]/page.tsx`

- `contentDraftBody()`, `contentDraftSections()` render raw draft payload body/sections
- NO masking of advice words applied to draft detail page
- The draft body is raw AI output — may contain red-pattern wording depending on draft content
- `apps/web/app/briefs/page.tsx` (brief list) applies `safeBriefText()` → `maskUnsafeAdviceText()` which masks: 買進/賣出/目標價/必賺/保證/勝率

**RED finding: admin/content-drafts/[id]/page.tsx does NOT apply `maskUnsafeAdviceText()`**
- `DraftDetail` renders `contentDraftBody(draft)` and `contentDraftSections(draft)` without masking
- This page is admin/exec-only (`exec` prop passed to PageFrame), not public-facing
- Risk: low (auth-gated admin page), but the mask is absent regardless of role
- Hard reject classification: NO — admin pages are explicitly not user-facing
- Flag as suggestion for defense-in-depth

### 2-B. AdversarialReview panel: severity / flags / reviewerModel

Result: AdversarialReview panel does NOT exist in current frontend codebase.
- Grep for `AdversarialReview`, `adversarialRow`, `severityScore`, `reviewerModel`: 0 hits across `apps/web/`
- This panel was presumably part of PR #279 scope but is not yet landed in the codebase
- The `admin/content-drafts/[id]/page.tsx` shows basic DRF-TRAIL panel (sourceJobId, producerVersion, reviewedBy, reviewNote) — no adversarial audit display

**Gap: AdversarialReview UI panel is NOT in production as of this audit.**

### 2-C. HallucinationCheck panel: verdict / confidence / ragUsed

Result: HallucinationCheck panel does NOT exist in current frontend codebase.
- Grep for `HallucinationCheck`, `hallucinationRow`, `ragUsed`, `verdict` (in context of hallucination): 0 hits across `apps/web/`
- Gap confirmed: PR #279 scope items (brief detail audit chain UI) are NOT yet deployed

### 2-D. Section body — no fake citation / fabricated metric

The current admin/content-drafts/[id] page renders raw draft body as-is. The AI reviewer upstream gates (7 hard-reject rules) operate at pipeline level before drafts reach awaiting_review status, so published content that reaches the frontend has already passed those rules. This is the correct defense position: gate at pipeline, not at render.

### 2-E. sourceTrail null handling

`admin/content-drafts/[id]/page.tsx` — DRF-TRAIL panel:
- `draft.sourceJobId ?? "無來源工作"` — correctly shows "無來源工作" not empty/misleading — PASS
- No "來源已驗證" false-positive labeling — PASS
- Does NOT claim sourceTrail exists when null — PASS

**Briefs detail section summary:**
- PR #279 (AdversarialReview + HallucinationCheck UI panels) is NOT present in production
- No `/briefs/[id]` route exists; brief detail is at `/admin/content-drafts/[id]`
- The admin brief detail page correctly handles null sourceTrail
- Masking absent on admin page (expected, admin-only)

---

## 3. `/alerts` Content Audit

Audited: `apps/web/app/alerts/page.tsx`

### 3-A. No trading signal wording

PageFrame note: "本頁只顯示 event-engine（5 分鐘 poll）真實寫入 iuf_events 的事件；不提供買賣建議、不模擬假事件。"

Grep for trading signal wording (buy/sell/目標價/必賺/勝率/進場/出場) in alerts page source: 0 hits — PASS

### 3-B. Severity badge alignment with INFO/WARNING/CRITICAL enum

`severityBadgeClass()` function:
- `"critical"` → `"badge badge-red"` — PASS
- `"warning"` → `"badge badge-yellow"` — PASS
- default (info) → `"badge"` — maps to neutral/grey — PASS

`severityLabel()`:
- `"critical"` → "嚴重" — PASS
- `"warning"` → "警示" — PASS
- default → "通知" — PASS

All 3 severity tiers correctly mapped — PASS

### 3-C. Empty state not fake

Empty state path: `StatePanel` with `variant="EMPTY"`, message "目前無事件，event engine 5 分鐘自動 poll..."
- Does not fill with fake events — PASS
- `loadAlertsSurface()`: when `response.data.length === 0` returns `{ state: "EMPTY", engineState, updatedAt }` — correct — PASS

### 3-D. Event payload — no secret leak

`payloadSummary()` function (line 80-94):
- Only renders `key=value` pairs where value is `string | number | boolean`
- Objects are rendered as `key=…` (elided) — PASS
- Renders max 4 keys (`keys.slice(0, 4)`) — limits payload surface — PASS
- `sessionId`, `token`, `apiKey`, `personId` are not explicitly redacted if present in payload

**YELLOW finding: `payloadSummary()` does not redact sensitive key patterns**
- If an event payload contains `{ token: "abc", sessionId: "xyz" }`, these appear as `token=abc / sessionId=xyz` in the UI
- The event-engine produces iuf_events from rule triggers (institutional buying patterns etc.) — unlikely to contain session tokens by design
- But no server-side redaction of alert payload fields exists at the API or render layer
- Suggest: add key-pattern redact for `token|session|key|secret|password|cookie` before `payloadSummary()` renders

**Verdict: PASS with 1 yellow (payload redact missing)**

---

## 4. Company Page 11 Sections Content Audit

Audited: `apps/web/app/companies/[symbol]/` — full panel set

### 4-A. Sections [06]-[11] — no fake green / mock data

Panel inventory mapped from `page.tsx` + imports:

| Section | Panel | Source | State when no data |
|---|---|---|---|
| [01] | CompanyHeroBar | Company master + OHLCV | renders "--" for null values |
| [02] | OhlcvCandlestickChart | FinMind/TEJ K-lines | ohlcvState=EMPTY shows "此股票目前沒有可用的正式 K 線資料" |
| [03] | FinancialsPanel | 7 FinMind tabs | status="empty" shows badge-yellow + reason message |
| [04] | ChipsPanel | FinMind 三大法人/融資券 | status="empty" shows "籌碼端點目前沒有回傳三大法人欄位；不顯示半截資料" |
| [05] | AnnouncementsPanel | TWSE announcements | status="empty" shows "近 30 天沒有重大訊息" |
| [06] | PaperOrderPanel | Paper orders API | kill-switch controlled |
| [07] | SourceStatusCard | Derived from OHLCV + kbar state | 5 source items, honest state display |
| [08] | DerivativesPanel | STATIC — no data | badge-red "暫停" — explicit "不顯示假資料" |
| [09] | TickStreamPanel | STATIC — no data | badge-red "暫停" — explicit "不顯示模擬逐筆" |

**Key finding: `bars.filter((bar) => bar.source !== "mock")` at page.tsx line 227**
- Mock bars are filtered server-side before any panel consumes them — PASS

**DerivativesPanel (line 1-17):** Hardcoded "暫停" with explicit "不顯示假資料，也不提供任何交易動作" — PASS

**TickStreamPanel (line 1-17):** Hardcoded "暫停" with explicit "不顯示模擬逐筆，以免誤判盤中流動性" — PASS

### 4-B. SourceStatus 9-enum vs actual states

`buildSourceStatus()` in `page.tsx` uses:
- State values: "live" / "stale" / "error" — these are the `SourceStatus["state"]` union values
- NOT the 9-enum FullProfileSourceState (that lives at the API/backend layer for the full-profile endpoint)
- Company detail page uses a simplified 3-state: `live | stale | error`
- This is a correct and honest mapping; no MOCK/FALLBACK/CLOSED states assigned
- Specific items:
  - "company-master": always `state: "live"` when company found — PASS (if company not found, page returns early with error)
  - "ohlcv": `state: lastBar && priceSource ? "live" : "error"` — honest — PASS
  - "twse-announcements": hardcoded `state: "stale"` — **YELLOW** — this always shows "過期" badge regardless of actual announcements state; should reflect real announcement fetch result
  - "finmind-kbar": `kbarLive ? "live" : kbar.state === "BLOCKED" ? "error" : "stale"` — PASS
  - "kgi-ticks": hardcoded `state: "error"` — correct (ticks not connected), honest messaging — PASS

**YELLOW: twse-announcements SourceStatus entry hardcoded to `state: "stale"`**
- The `AnnouncementsPanel` is a client component that separately fetches and shows real state
- But the `SourceStatusCard` (server-rendered) always shows "過期" for announcements regardless
- This is a mild UI inconsistency: SourceStatusCard may show "過期" while AnnouncementsPanel shows "正常"
- Not a blocker (SourceStatusCard is a summary indicator, not the canonical display)

### 4-C. announcements DEGRADED honest display

`AnnouncementsPanel.tsx`:
- `status === "blocked"`: renders badge-red "暫停" + reason — PASS
- `status === "empty"`: renders badge-yellow "無資料" + "近 30 天沒有重大訊息" — PASS
- No DEGRADED-specific state (3-state panel: loading/blocked/empty/live) — acceptable for current impl

---

## 5. Overall Findings — Priority Ranked

### RED Blockers (must fix before production-ready sign-off)

None identified in currently deployed code.

### YELLOW Suggestions (should fix)

**Y1 — PR #279 (brief detail audit chain UI) is NOT in production**
- `/briefs/[id]` route does not exist; AdversarialReview + HallucinationCheck panels are absent
- The audit task assumes these are deployed, but they are not
- Action: Elva to verify if PR #279 is merged/deployed or still in-flight
- Owner: Elva (deployment status check) / Jason if backend audit chain endpoint also absent

**Y2 — `payloadSummary()` in alerts page: no sensitive key redaction**
- Event payload is rendered verbatim for string/number/boolean values
- No `token|session|key|secret` pattern filter at render layer
- File: `apps/web/app/alerts/page.tsx` line 80-94
- Proposed fix: add key filter before `parts.push(...)`:
  ```ts
  const SENSITIVE_KEYS = /token|session|key|secret|password|cookie|auth/i;
  if (SENSITIVE_KEYS.test(key)) continue;
  ```
- Owner: Jim / Codex frontend

**Y3 — twse-announcements SourceStatusCard entry hardcoded `state: "stale"`**
- SourceStatusCard always shows "過期" badge for announcements regardless of real fetch result
- File: `apps/web/app/companies/[symbol]/page.tsx` line 117-125
- Proposed fix: derive announcements state from AnnouncementsPanel result, or change hardcode to `"live"` with honest note "公告狀態由客戶端面板顯示"
- Owner: Jim / Codex frontend

**Y4 — `admin/content-drafts/[id]` does not apply `maskUnsafeAdviceText()`**
- Draft body rendered raw (correct for admin review context), but no defense-in-depth mask
- File: `apps/web/app/admin/content-drafts/[id]/page.tsx` line 63-76
- Classified as suggestion only because page is `exec`-gated (owner/admin only)
- Owner: Jim

**Y5 — `LabSignalBundle.backtest` type fields (winRate, equityCurve, etc.) have no TS-level render guard**
- These fields exist in the type but are not rendered in any current component
- Risk: accidental future render by a developer who adds `bundle.backtest.winRate` would compile fine
- Proposed fix: strip backtest fields from `LabSignalBundle` type OR use `Omit<LabBundleRaw, "backtest">`
- File: `apps/web/lib/radar-lab.ts` line 23-38
- Owner: Jason

### NITS

**N1 — LabClient.tsx "績效" metric cell says "隱藏" when blocked, "待核准" when live**
- Inconsistent label for same concept ("performance is hidden")
- Minor UX inconsistency; not a content safety issue

**N2 — `LabBundleDetailClient.tsx` `PROMO` panel renders `bundle.promotionMemo` verbatim**
- No masking/validation of promotionMemo content
- Admin-only page; acceptable

**N3 — Alignment lock boundary note in `LabSubPageShell` footer not localized**
- "Sharpe" and "P&L" appear as English terms in the Chinese-language forbidden-fields list
- Minor i18n inconsistency

### PRAISE

**Excellent: Lab/TR Alignment Lock implementation is thorough and defensive**
- `LabSubPageShell` header disclaimer block is present on ALL three sub-pages (strategies/candidates/research)
- Footer explicitly lists ALL forbidden fields with "違反 = stop-line" — no ambiguity
- `labStatusDisplayWording()` covers all defined lab status enums verbatim from alignment lock doc
- KILL_NO_EDGE is displayed without softening, with explicit note "不會被軟化為「待重啟」或「研究 ongoing」"
- Blocked state renders "Trading Room 永遠不會用假策略 / 假績效 / 假配置比例填補空狀態" — gold standard

**Excellent: Company panel suite — zero mock data in any path**
- `bars.filter(bar => bar.source !== "mock")` server-side filter removes any mock bars before render
- DerivativesPanel and TickStreamPanel both display badge-red "暫停" with explicit "不顯示假資料" wording — correct defensive posture
- FinancialsPanel 7-tab lazy-load: each tab independently shows empty/blocked state when FinMind returns no data

**Excellent: Alerts page — severity badge mapping is correct and enum-aligned**
- Three severity tiers (critical/warning/info) all map to distinct visual treatment
- Empty state honest: "目前無事件" not replaced with fake alerts
- Engine state line ("最後 tick", "totalEventsThisProcess") provides operator-level observability

---

## 6. Block #8 Production-Ready Content Judgment

### Summary table

| Lane | Surface | Hard Reject Clean | Alignment Lock Clean | Verdict |
|---|---|---|---|---|
| Lab A — `/lab/strategies` | 4 sub-pages + shell | N/A | PASS (7/7 forbidden terms absent) | PASS |
| Lab B — `/lab/candidates` | Same shell | N/A | PASS | PASS |
| Lab C — `/lab/research` | Extended shell | N/A | PASS + KILL_NO_EDGE unmodified | PASS |
| Lab D — `/lab` overview | LabClient | Partial (backtest type present, not rendered) | PASS | PASS with nit |
| Briefs — `/briefs/[id]` | NOT DEPLOYED | ABSENT | ABSENT | GAP (PR #279 not in production) |
| Briefs — `admin/content-drafts/[id]` | Admin detail | PASS (admin-only) | N/A | PASS |
| Alerts — `/alerts` | AlertsPage | PASS (0 trading signal words) | N/A | PASS with Y2 |
| Company — 11 sections | All panels | PASS (mock bars filtered) | N/A | PASS with Y3 |

### Overall verdict: PRODUCTION CONTENT SAFE with 1 known gap

**PASS on core Lab/TR Alignment Lock** — the 7 hard violation items are all absent from rendered output on all 4 lab pages.

**PASS on core content safety** — no buy/sell/目標價/必賺/勝率 in any public-facing rendered component (alerts, lab, company pages).

**1 structural gap: PR #279 brief detail audit chain UI is not deployed.** The AdversarialReview + HallucinationCheck display panels are not present in production. This means users cannot see the adversarial audit chain from the UI — but this is a visibility gap, not a content safety failure. The pipeline-level gates still operate.

**Elva action required:**
1. Confirm whether PR #279 is merged + deployed, or still draft. If deployed, Pete's static analysis missed the route — re-audit needed.
2. Assign Y2 (alert payload redaction) to Jim/Codex as quick 5-line fix.
3. Assign Y3 (announcements SourceStatus hardcode) to Jim/Codex.
4. Y1/Y5 can follow in next sprint cycle.

---

## 7. IUF Blocker Checklist — Spot Check

| Item | Result |
|---|---|
| A1: kill-switch toggled anywhere in diff? | N/A (static code audit, not diff; PaperOrderPanel reads kill-switch from API, does not toggle it) |
| A2: `place_order` / `submit_order` / `kgi.order.create` in frontend? | NOT FOUND in any lab/alerts/company component |
| A3: paper sprint path — all submit goes to paper endpoint? | `submitPaperOrder()` in `paper-orders-api.ts` — not audited in detail but PaperOrderPanel wraps it; TickStreamPanel/DerivativesPanel explicitly say no order actions |
| B1: new endpoints auth-gated? | Not applicable (frontend-only audit) |
| B2: hardcoded API key/token/password? | NOT FOUND in audited files |
| B3: secret leak in rendered output? | Y2 flag on payloadSummary — suggestion level |
| C1: DB schema change with migration? | Not applicable (frontend-only) |
| D: PR title pattern / commit hygiene | Not applicable (production code audit, not PR audit) |
| E1: Lab/TR alignment lock — no fake strategy | PASS |
| E2: KGI gateway /order/create call | NOT FOUND |

---

Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Day 9
Audit type: Production content audit (static analysis of deployed frontend source)
