# TR Browser QA — 2026-05-13

**Analyst**: Jim (frontend-consume)
**Date**: 2026-05-13 00:35 TST
**Source**: `origin/main` commit `72f5a87` (2026-05-12 23:45 TST)
**Method**: Source code static analysis + production HTTP probe (auth-only pages)

---

## QA Method Note

Production URL: `https://app.eycvector.com`
All `/lab` routes are auth-protected (middleware redirects unauthenticated → `/login`).
Unauthenticated curl returns the login page HTML (HTTP 200 after 307 redirect).
Browser screenshot session requires valid session credentials not available in automated context.

**Alternative method used**: Source code analysis of `origin/main` + HTTP status probes.
Screenshot placeholder files are written to `screenshots_2026-05-13/` with full source evidence.

---

## 1. Production Health Probes

| URL | HTTP Status | Notes |
|-----|-------------|-------|
| `https://app.eycvector.com/lab` | 307 → 200 | Redirects to login (auth-protected). Login page renders correctly. |
| `https://app.eycvector.com/lab/three-strategy/cont_liq_v36` | 307 → 200 | Same — auth redirect then login page. |
| `https://api.eycvector.com/api/v1/lab/strategy/cont_liq_v36/snapshot` | 401 | Returns `{"error":"unauthenticated"}` — correct, requires auth. |

All endpoints respond correctly. No 500 errors. No blank page at the HTTP level.

---

## 2. Screenshots Status

**Status**: NOT available in this automated QA run.

**Reason**: Production auth-protected; no browser tool with session cookie available in automated context.

**What would be needed for real screenshots**:
- A valid `iuf_session` cookie for an Owner-level account
- `chromium --screenshot` or equivalent browser tool
- Viewport: 1440px (desktop) and 375px (mobile)

**Alternative evidence provided**: Full source-level rendering analysis (see Section 3 below).

**Screenshot folder**: `evidence/w7_paper_sprint/screenshots_2026-05-13/`
Files: `README_screenshots_not_available.txt` (explaining auth requirement)

---

## 3. Page-by-Page QA Checklist (Source-Level)

### 3a. `/lab` — Desktop

**Source**: `apps/web/app/lab/page.tsx` on origin/main

| Check | Result | Evidence |
|-------|--------|----------|
| No blank page | PASS | Page renders via `PageFrame` with `dynamic = "force-dynamic"`. Fallback strategy list hardcoded. |
| No console fatal | PASS | No unhandled promise rejections in source; `getLabThreeStrategySnapshot()` has try/catch fallback. |
| No overlapping text | PASS | Responsive CSS: `grid-template-columns: repeat(3, ...)` collapses to 1-col on mobile via media query. |
| No missing chart | PASS | Mini sparklines are SVG (inline, no external fetch). cont_liq uses hardcoded 13-point array. strategy_002/003 uses dashed pending sparkline. |
| No misleading return label | PASS | `PageFrame note=` explicitly states "Strategy return, benchmark return, and excess return are separated. No broker write action is exposed." |
| No broker action button | PASS | `/lab` entry page shows only strategy cards and CTA links to detail pages. No order/broker UI. |
| No hidden caveat | PASS | Caveat text rendered inline in card body. `whiteSpace: "normal"` ensures no truncation. |

**Mobile** (375px): 3-col grid collapses to 1-col via `@media (max-width: 640px)`. KPI bars collapse to 2-col. Confirmed in CSS.

### 3b. `/lab/three-strategy/cont_liq_v36` — Desktop

**Source**: `page.tsx` + `ContLiqPeriod1Panel.tsx` + `ContLiqHistoricalEvidencePanel.tsx` on origin/main

| Check | Result | Evidence |
|-------|--------|----------|
| No blank page | PASS | Server component with parallel fetch; OHLCV failures caught individually (null = "--"); no single point of failure causing blank. |
| No console fatal | PASS | All `await getCompanyByTicker()` / `getCompanyOhlcv()` calls wrapped in try/catch. KGI fetch wrapped with error return `{state:"blocked"}`. |
| No overlapping text | PASS | CSS `_cl1-*` and `_clh-*` use inline `<style>` scoped to component. Grid + flex with explicit overflow handling. |
| No missing chart | PASS | No chart dependency in this page. Uses progress bar (CSS) + holding table (grid). No lightweight-charts dependency. |
| No misleading return label | PASS | `PageFrame note=` states "研究前向觀察記錄。不顯示已驗證、approved、可上線或任何背書字樣。非交易建議。" |
| No broker action button | PASS | Zero broker/order UI in ContLiqPeriod1Panel or ContLiqHistoricalEvidencePanel. No `<form>` / order submit. |
| No hidden caveat | PASS | Status banner uses `style.display: block` always (not conditional). B-zone caveats use `not-tag` spans. |

**Mobile** (375px): `_cl1-table-head { display: none }` (table header hidden). `_cl1-table-row` switches to 2-col grid. KPI bar collapses to 2-col. `_clh-b2-columns` collapses to 1-col. Confirmed in CSS.

### 3c. Daily Brief Page

**URL**: `/briefs`
**Status**: Not in scope for this specific QA task (task specified `/lab` + `/lab/three-strategy/cont_liq_v36`).
**Note**: The `apps/web/app/briefs/page.tsx` is separate from lab; not audited in this pass.

### 3d. KGI SIM Status Panel

**Status**: No UI surface exists as of origin/main.
PR #395 added `GET /api/v1/internal/kgi/sim/daily-smoke-status` (API only).
No frontend panel component was created — this is backend-only.
**Verdict**: N/A — no UI to audit. Bruce verify task covers the API endpoint.

---

## 4. Missing Content Checks

### `/lab/three-strategy/cont_liq_v36` — Required Sections Present

| Section | Present | Source Location |
|---------|---------|-----------------|
| Status banner (research disclaimer) | YES | `ContLiqPeriod1Panel.tsx` lines 565-570; always rendered before other content |
| Day-0 anchor hero | YES | `_cl1-anchor` div with `2026-05-06` |
| Forward observation progress bar | YES | `_cl1-progress-wrap` with approx trading days / H20 target |
| Basket KPI 4-cell | YES | `_cl1-kpi-bar`: avg return / PnL / 0050 bench / excess |
| Per-holding table | YES | 4 rows: 3707 / 2426 / 6205 / 2486 |
| B.1 Evidence zone | YES | `ContLiqHistoricalEvidencePanel.tsx` B.1 section |
| B.2 Common-window 3-col | YES | `ContLiqHistoricalEvidencePanel.tsx` B.2 section |
| Research disclaimer repeat | YES | Bottom of ContLiqPeriod1Panel |

All sections confirmed present.

---

## 5. State Handling

### KGI Gateway States (ContLiqPeriod1Panel)

| State | Renders | Evidence |
|-------|---------|----------|
| loading | `_cl1-badge.loading` "載入中" | Lines 489-490 initial state |
| live | `_cl1-badge.live` "即時" | Line 421 |
| stale | `_cl1-badge.stale` "盤後" | Line 422 |
| blocked | `_cl1-badge.blocked` with reason string | Lines 423, 406-414 |

4-state pattern confirmed. BLOCKED shows real reason string — NOT fake-green. Confirmed.

### Entry Price Unavailable State

When OHLCV fetch fails: `entryPrice = null` → renders `"--"` (line 448-450). No fake value substituted. Confirmed.

---

## 6. Product Language Conformance in Rendered Labels

Cross-reference with product language QA file (`TR_V47_PRODUCT_LANGUAGE_QA_2026-05-13.md`):

| Label Type | Current (origin/main) | Verdict |
|-----------|----------------------|---------|
| 策略同窗淨報酬 | `策略淨報酬` (label) + `策略純報酬 (net)` (sub) + `同窗口淨報酬` (B.2 sub-label) | PASS (semantic equivalent) |
| 0050 同窗基準報酬 | `0050 同窗報酬` (label) + `同窗口基準報酬` (sub) | PASS |
| 策略報酬減基準報酬 | `策略報酬 − 基準報酬` (sub-label in 3-col grid) | PASS |
| 最大回撤 | `最大回撤 (net)` | PASS |
| Sharpe | `Sharpe (年化)` | PASS |
| Hit rate | `Hit Rate` | PASS |
| Forward observation | `Forward Observation Period 1` (page title, progress section) | PASS |

---

## 7. Overall Verdict

| Area | Status |
|------|--------|
| `/lab` page — no blank, no fatal, no broker CTA, no hidden caveat | PASS |
| `/lab` mobile collapse | PASS (CSS confirmed) |
| `/lab/three-strategy/cont_liq_v36` — all required sections present | PASS |
| `/lab/three-strategy/cont_liq_v36` — status banner always shown | PASS |
| `/lab/three-strategy/cont_liq_v36` — OHLCV null graceful | PASS |
| KGI 4-state confirmed | PASS |
| D4 snapshot graceful (embedded fallback, no blank) | PASS |
| KGI SIM status panel | N/A (backend API only, no frontend panel) |
| Browser screenshots | NOT AVAILABLE (auth-protected, no browser session) |

**QA overall: PASS on all checkable items. Screenshots require authenticated browser session.**
