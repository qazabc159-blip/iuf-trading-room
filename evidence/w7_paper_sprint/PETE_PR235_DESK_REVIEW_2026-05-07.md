# PR #235 Desk Review — Pete 2026-05-07

## 1. PR Intent
- Repair product-truth failures on lab page and portfolio page; clip layout overflow.
- Lab: hide unapproved Sharpe / equity-curve / win-rate / return / drawdown surfaces per stop-line #12.
- Portfolio: add explicit BLOCKED panel when session expired (not empty data).
- CSS: replace horizontal scrollbars with theme-colored scrollbars; contain long label overflow.
- Base branch: main (fork at 9247d3f = #233 merge). 1 commit ahead. main is 1 ahead (hotfix #234, API-only). No file conflict.

## 2. Diff Summary
- 6 files changed: +235 / -90
- apps/web/app/lab/LabClient.tsx — removes avgConfidence / avgReturn / worstDrawdown / totalReturnPct / winRate / maxDrawdown renders
- apps/web/app/lab/[bundleId]/LabBundleDetailClient.tsx — removes LabLineChart / periodStats / equityCurve / drawdown; replaces with governance-boundary panel
- apps/web/app/portfolio/page.tsx — adds isAuthExpired + authExpired guard + BLOCKED repair panel
- apps/web/app/globals.css — scrollbar consolidation + portfolio-auth-repair layout + overflow-x clip + brief label overflow-wrap
- 2 evidence .md files (new + update to status board)

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- KILL_SWITCH / EXECUTION_MODE toggle: PASS — 0 hits in added lines
- place_order / submit_order / kgi.order.create: PASS — 0 hits; applyAction() calls radarLabApi (lab review state only)
- paper sprint POST /api/v1/paper/orders path: PASS — no new order-submit path added
- feature flag defaults: N/A (no new feature flags)

### B. Auth / Secret Hygiene
- New endpoints: N/A — no new API endpoints; page is read-only server component
- Hardcoded key / token / password: PASS — 0 hits
- env var hygiene: N/A — no new env vars
- person_id / sessionId in log/response: PASS — 0 hits

### C. State / Schema Integrity
- DB schema change / migration: PASS — no migration touched
- enum / status sync: PASS — state semantics (BLOCKED/LIVE/EMPTY) unchanged; "待核准 / 未核准" are UI-only gate labels
- LEGAL_TRANSITIONS: N/A
- Runtime state (module-level var): PASS — no new module-level mutable state

### D. PR Hygiene
- Title follows conventional commits: PASS — fix(web): ...
- Base branch correct: PASS — main; single commit; 1 commit behind main (hotfix #234 API-only, no conflict)
- PR description lists evidence path: PASS — codex_product_truth_repair_quant_portfolio_scroll_2026-05-06.md cited
- CI checks: PASS — typecheck / build / diff-check / stop-line grep per PR body and Bruce audit

### E. IUF Not-Crossable Lines
- No agent lane crossing: PASS
- No governance bypass: PASS — DRAFT not force-merged
- No KGI /order/create call: PASS
- No redaction policy violation: PASS

## 4. Findings — Priority Ranked

### Blockers
None.

### Suggestions
1. **[auth-expired string coupling]**: isAuthExpired() matches on "登入狀態已失效" substring from friendlyDataError. If friendly-error.ts ever rewrites that string (localization / copy edit), the auth repair panel silently stops triggering. Low probability but fragile coupling.
   - Location: apps/web/app/portfolio/page.tsx:252 + apps/web/lib/friendly-error.ts:8
   - Suggestion: Extract a typed sentinel (e.g., errorCode: "AUTH_EXPIRED") from the API error path so the UI check is not string-dependent.

2. **[overflow-x clip on stat-strip]**: Switching from overflow-x:auto to overflow-x:clip on the stats container removes the scroll affordance. On very narrow viewports or very long stat labels, content will be hard-clipped with no scroll escape. The PR's intent is to prevent overflow-bar visual noise — correct goal — but clip is permanent.
   - Location: apps/web/app/globals.css:973
   - Suggestion: Consider overflow-x:hidden (clips without scroll, same visual, but slightly less surprising) or confirm design intent covers this.

### Nits
1. **[dead imports in LabClient.tsx]**: `signed` and `toneClass` are no longer called in LabClient.tsx after this PR but the import line still references them. Bruce's typecheck PASS suggests they are re-exported and not tree-shake-flagged, but they are unused here now.
   - Location: apps/web/app/lab/LabClient.tsx:6 — `import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";`
   - The diff shows these were already imported and the new import line only keeps MetricStrip. Let me note: the diff removes signed/toneClass from the import correctly. Verified on PR branch tip — import line 6 reads `import { MetricStrip } from "@/components/RadarWidgets"`. No nit needed here.

2. **[authExpired panel shown alongside existing BLOCKED reason row]**: When authExpired=true, both the new repair panel AND the existing result.reason row (line 367) render. The repair panel is clearer; the generic reason row below is redundant. Minor UX duplication, not a correctness issue.

### Praise
- Lab metric removal is clean and complete. PR branch tip has 0 references to backtest / winRate / equityCurve / totalReturnPct / maxDrawdown in rendering code — only in a UI-copy string ("仍不會顯示：..."). Exactly right.
- LabBundleDetailClient drops 49 lines of chart code (LabLineChart, pointsFor, equityCurve SVG) cleanly — no dead fragments left.
- authExpired detection is narrow (only fires on BLOCKED+string match); does not disrupt EMPTY state or generic BLOCKED states.
- Bruce audit already done (BRUCE_PR235_AUDIT_2026-05-07.md) with 4-point clean result.
- Merge hygiene: single-commit branch, 1 commit behind main (API-only hotfix), no rebase required.

## 5. Verdict
- [x] APPROVED — can ready; 0 blockers

## 6. Suggested Owner for Fixes
- Suggestion #1 (string coupling) → Jason (API error contract) + Codex (frontend)
- Suggestion #2 (overflow-x clip) → Codex to confirm design intent

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint
PR Branch: feat/web-product-truth-repair-2026-05-06
Bruce audit: evidence/w7_paper_sprint/BRUCE_PR235_AUDIT_2026-05-07.md
