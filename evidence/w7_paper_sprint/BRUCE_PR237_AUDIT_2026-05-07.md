# PR #237 Audit — BRUCE_PR237_AUDIT_2026-05-07

**Branch**: feat-web-home-workflow-repair-2026-05-06
**Head**: aa7ac74
**Scope**: apps/web/app/page.tsx (+462/-524) / globals.css (+47) / PageFrame.tsx (minor) / codex evidence md
**CI**: 3x SUCCESS (from task spec)
**Date**: 2026-05-07 (TST)
**Auditor**: Bruce (static analysis, Bash active)

---

## 7 Audit Point Results

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | 4-axis alignment | PARTIAL_PASS | Axis 1 K-line: link to /companies/2330 with "K 線" mention — PASS. Axis 2 strategy registry: strategyPanel wired (ideas+runs) but NO Athena 001/NOT_PAPER_READY caveats surfaced — PARTIAL. Axis 3 paper portfolio: paperPanel wired with loadPaperHealthState() + CTA to /portfolio — PASS. Axis 4 OpenAlice: openAlicePanel wired with PUBLISHED/AWAITING_REVIEW/MISSING state + CTA — PASS. |
| 2 | Not cosmetic only | PASS | 4 new load functions (loadFinMindDashboard / loadDailyBriefDashboard / loadPaperHealthState), hero stat bar, 4 real panels with live data wiring. Structural functional change confirmed. |
| 3 | no-token / no-fake-Sharpe / no-buy-sell wording | PASS | grep: 0 hits for "buy", "sell", "Sharpe", "假績效", "broker.submit", "order/create" in added lines of page.tsx. Token label shows "存在/缺失" not value — clean. |
| 4 | Strategy 4 caveats / Athena verdict | FAIL | strategyPanel shows ideaCount / blockedIdeas / runCount / "待核准" only. No explicit mention of exp_001 dead-leg / 反向假設破 / NOT_PAPER_READY. Athena verdict is NOT honestly surfaced on homepage. Axis 2 = partial coverage. |
| 5 | Paper portfolio empty-state CTA | PASS | paperPanel present: loadPaperHealthState() wired, shows previewReady/submitReady/gateOpen/queueDepth/lastFillTs. CTA: actionDeck links /portfolio. Empty-state not left blank — panel renders with status pills even when data is null. |
| 6 | K-line freq=1d true wired | PARTIAL | Homepage itself has no direct K-line chart. Link to /companies/2330 present with "K 線" context. Actual freq=1d fix was in hotfix #234 (backend) — homepage only adds navigation entry. No regression introduced. Marking PASS as homepage is not the K-line render surface. |
| 7 | 23+ stop-line scan | PASS | 0 /order/create in added lines. 0 broker.submit. 0 kgi_session / password / secret in page.tsx diff. 0 contracts/src mutation. 0 strategy-engine / risk-engine / paper-broker touch. 0 fake-Sharpe / buy-sell wording. CSS additions (globals.css +47) are layout-only. |

---

## 4-Axis Alignment Detail

| Axis | Label | Status | Evidence |
|------|-------|--------|----------|
| 1 | K-line | LINKED | /companies/2330 CTA "K 線、FinMind 財務、紙上 preview 從這裡開始" |
| 2 | Strategy registry | PARTIAL | strategyPanel wired but Athena 001 caveats absent |
| 3 | Portfolio paper status | WIRED | paperPanel: gateOpen / previewReady / submitReady / lastFillTs |
| 4 | OpenAlice pipeline state | WIRED | PUBLISHED/AWAITING_REVIEW/MISSING 3-state + draftCount + CTA |

---

## Blocking Finding

**F1 (axis 2 gap)**: strategyPanel does not surface Athena verdict "exp_001 dead leg / 反向假設破 / NOT_PAPER_READY". It only shows ideaCount + blockedIdeas + "待核准" label. The product north star audit criterion #4 requires honest surfacing of Athena caveats. This is a functional gap, not cosmetic.

**Severity assessment**: MINOR_BLOCK — the panel exists and does not mislead (no fake performance, no buy/sell), but it does not satisfy the explicit "Athena verdict honestly surface" requirement. The question is whether "等待 Athena bundle 與 Bruce harness" text + "待核准" is sufficient signal.

**Bruce judgment**: This satisfies the "no fake performance" hard line but does NOT satisfy "honestly surface Athena 001 dead-leg verdict". Recommend: CONDITIONAL_APPROVE — merge if Elva waives axis-2 caveat surface requirement for this PR, with a follow-up task to Codex to add Athena bundle status widget.

---

## Verdict

**CONDITIONAL_APPROVE**

7 audit points: 5 PASS / 1 PARTIAL (K-line = nav link only, acceptable) / 1 FAIL (Athena caveats not surfaced)
4-axis: 3 fully wired / 1 partially wired (axis 2 strategy — no Athena verdict text)
No stop-lines triggered. No secrets. No cosmetic-only. Paper CTA present. OpenAlice 3-state wired.

**Merge recommendation**: YES with Elva waive on axis-2 Athena caveat surface — create follow-up task. If Elva requires strict axis-2 compliance before merge: BLOCK pending 1 addition to strategyPanel.
