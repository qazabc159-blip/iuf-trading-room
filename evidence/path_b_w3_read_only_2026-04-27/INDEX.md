---
name: W3 Read-Only Expansion Sprint — Evidence INDEX
description: W3 sprint evidence dir 單頁索引；本 sprint 仍 NOT paper-ready / NOT live / NOT broker / NOT production trading
type: index
date: 2026-04-27
window: 2026-04-27 ~22:xx TST → (autonomous block in flight)
---

# W3 Read-Only Expansion Sprint — INDEX

W3 sprint evidence dir 單頁索引（dir：`evidence/path_b_w3_read_only_2026-04-27/`）。

**Sprint kickoff**：2026-04-27 ~22:xx TST（楊董 verbatim「現在啟動 W3 Read-Only Expansion Sprint」）
**main HEAD**：`95466f4`
**前一輪**：`evidence/path_b_w2a_20260426/INDEX.md`（含 W2a/W2b/W2c/W2d/post-merge）

---

## 1. Lane A — Sprint Governance (Elva, 5 docs ✅)

| File | Purpose |
|---|---|
| `w3_read_only_sprint_plan.md` | Sprint plan + scope + DoD + risks（§0-§8）|
| `w3_lane_dispatch_table.md` | Lane B1/B2/C/D/E 派工細節（scope / allowed / prohibited / deliverable / DoD） |
| `w3_hard_line_matrix.md` | 14 stop-lines + 10 not-allowed + 9 Green+ allowed + lane sub-hard-lines + #23 special hard-line + 4 deferred hard-line |
| `w3_deferred_operator_check_runbook_index.md` | T6/T7/T8/T12 frozen state index；不准跑；楊董 ACK 才解封 |
| `w3_closeout_template.md` | Lane A 9-section closeout template |

---

## 2. Lane B — Backend (Jason, in flight)

| Branch | Purpose | Status |
|---|---|---|
| `feat/w3-quote-hardening` | B1 — H-6 structured logging + H-9 ring buffer eviction + observability | DRAFT in flight |
| `feat/w3-kbar-phase2` | B2 — `/quote/kbar/recover` + WS subscribe skeleton + interval matrix + mock fallback + no-order tests | DRAFT in flight |

Expected files (post-completion)：
- `jason_w3_quote_hardening_impl_note.md`
- `jason_w3_kbar_phase2_impl_note.md`
- `jason_w3_kbar_interval_matrix.md`

---

## 3. Lane C — Frontend Sandbox (Jim, in flight)

Sandbox dir：`evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/`

Expected closeout：`evidence/design_handoff_2026-04-26/v0.7.0_work/v0.7.0_package/jim_w3_sandbox_closeout_2026-04-27.md`

---

## 4. Lane D — Verify Harness (Bruce, in flight)

Sub-dir：`bruce_w3_verify_harness/`

Expected files (post-completion)：
- `no_order_guarantee_matrix.md`
- `kbar_verify_checklist.md`
- `quote_hardening_verify_checklist.md`
- `frontend_sandbox_verify_checklist.md`
- `redaction_v1_audit.md`
- `wording_audit.md`
- `deferred_live_http_frozen.md`

---

## 5. Lane E — Athena Governance (HOLD)

無檔；不阻塞 sprint 收板。

---

## 6. W3 Merge-Window — CLOSED GREEN+ (2026-04-27)

| File | Purpose |
|---|---|
| `bruce_w3_pre_merge_final_check.md` | Bruce 10/10 PASS pre-merge gate |
| `bruce_w3_post_merge_regression.md` | Bruce 16/16 PASS post-merge regression |
| `w3_merge_window_closeout_2026-04-27.md` | 10-section consolidated merge-window closeout |
| `w4_plan_draft_2026-04-27.md` | W4 plan read-only draft (9 sections) |

Merges: PR #6 squash `57f7627` (quote hardening) + PR #7 squash `fab35f2` (K-bar Phase 2). main HEAD = `fab35f2`. GHA CI run `24996928346` SUCCESS / Railway auto-deploy fired.

---

## 7. W4 Operator Window + Green+ Autonomous Block — CLOSED PASS_WITH_FLAGS (2026-04-27)

| File | Purpose |
|---|---|
| `w4_operator_window_consolidated_closeout_2026-04-27.md` | 13-section W4 round closeout |
| `kbar_route_mismatch_correction_2026-04-27.md` | K-bar route documentation drift correction (`/intervals` doesn't exist) |
| `bruce_w4_partA_partB_lane4_audit.md` | Bruce Phase 1: A1-A7 operator checks + Part B route audit + Lane 4 #4-#6 |
| `bruce_w4_lane4_phase2_audit.md` | Bruce Phase 2: Lane 4 #1-#3 cross-audits (Jim PR / Jason redaction / Athena scope) |
| `jim_w4_lane1_frontend_cutover_closeout.md` | Jim Lane 1 DRAFT PR #8 closeout |
| `kgi_position_crash_escalation_package.md` | Jason Lane 2 — KGI escalation main doc |
| `kgi_position_support_questions.md` | Jason Lane 2 — 10 questions for KGI engineering |
| `reproduction_summary_redacted.md` | Jason Lane 2 — minimal repro with `<REDACTED_*>` placeholders |
| `bruce_w4_odd_lot_fix_verify_checklist.md` | Bruce next-window verify checklist for Jason `odd_lot` fix (PREPARED, NOT EXECUTED) |
| `jason_w4_odd_lot_kwarg_fix_impl_note.md` | Jason DRAFT PR #9 impl note — `odd_lot` kwarg removal from `subscribe_kbar()` |

**DRAFT PR #9** `feat/w4-kbar-odd-lot-fix` → main, commit `be5ba7f`, 1 file (`services/kgi-gateway/kgi_kbar.py` +4/-2), DRAFT/MERGEABLE. Live verify `BLOCKED_PENDING_GATEWAY_RESTART_BY_OPERATOR`. URL: https://github.com/qazabc159-blip/iuf-trading-room/pull/9

Key results:
- T12 `/order/create` live HTTP 409 NOT_ENABLED_IN_W1 — safety hard-line **HELD**
- 17/17 stop-line HELD / 0 triggered
- 2 flags escalated: B2 Q1 `subscribe_kbar(odd_lot=...)` SDK kwarg blocks K-bar live + T7 gateway-layer whitelist gap
- Jim DRAFT PR #8 `feat/w4-frontend-cutover` (commit `f0b7834`, 18 files / 2207 insertions); held DRAFT pending Jason K-bar fix
- contracts HEAD `9957c91` UNCHANGED; main HEAD `fab35f2` UNCHANGED

Lane 3 Athena 5 docs filed at `IUF_QUANT_LAB/evidence/w4_unblock_package_2026_04_27/` (not in this dir — sister-company side).

---

## 8. PR #8 Overnight Augment — 2026-04-28 (Jim)

**Trigger**: 楊董 sleeping; Mission Command Mode overnight augment of DRAFT PR #8.

**New commit**: `5a440e2` on `feat/w4-frontend-cutover`

| File | Purpose |
|---|---|
| `jim_w4_promotion_risk_list.md` | §1-§5 production promotion risk list |
| `jim_w4_dependency_impact_note.md` | §1-§5 dependency impact (6 new deps, risk LOW) |
| `jim_w4_bundle_impact_note.md` | Bundle size before/after + lightweight-charts flag |
| `jim_w4_rollback_note.md` | Rollback runbook — ETA < 10 min, 0 DB impact |
| `jim_w4_screenshot_package.md` | Screenshot manifest for Bruce pre-merge |

**Code fix in commit**: `apps/web/package.json` + `pnpm-lock.yaml` — 6 missing deps added for reproducible build.

**Verify results**:
- PositionContainmentBadge: ALREADY PRESENT (StockDetailPanel line 150, always rendered)
- OrderLockedBanner: ALREADY PRESENT (StockDetailPanel line 108, always rendered)
- /order/create in PR #8 files: 0 hits (grep verified)
- paper/live ready wording in PR #8 files: 0 hits (grep verified)
- Pre-existing `order-ticket.tsx` `[SUBMIT 送單]`: W2d design, NOT in PR #8 diff — escalated as Risk D

**Status**: DRAFT holds. 10/10 hard lines HELD.

---

## Cross-Reference

- Mission Command Mode v1.0：`memory/feedback_mission_command_mode.md`
- W2d post-merge consolidated closeout：`evidence/path_b_w2a_20260426/w2d_post_merge_consolidated_closeout_2026-04-27.md`
- W2a Cumulative Evidence Index：`evidence/path_b_w2a_20260426/INDEX.md`
- Quote hardening source plan H-1～H-9：`evidence/path_b_w2a_20260426/jason_quote_api_hardening_plan_2026-04-27.md`
- K-bar Phase 2 feasibility：`evidence/path_b_w2a_20260426/jason_kbar_phase2_feasibility_2026-04-27.md`

— Elva, 2026-04-27 W3 kickoff
