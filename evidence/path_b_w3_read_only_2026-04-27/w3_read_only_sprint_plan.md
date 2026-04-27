---
name: W3 Read-Only Expansion Sprint Plan
description: 楊董 2026-04-27 GO authorization for W3 Read-Only Expansion Sprint — quote hardening + K-bar Phase 2 + frontend sandbox real-data-ready + Bruce verify harness; NOT paper-ready / NOT live / NOT broker / NOT production trading
type: sprint_plan
date: 2026-04-27
runner: Elva (team-lead-elva)
gate: 楊董 verbatim GO「現在啟動 W3 Read-Only Expansion Sprint」
---

# W3 Read-Only Expansion Sprint — Plan

## §0. Authorization

**楊董 GO @ 2026-04-27 ~22:xx TST**：「現在啟動 W3 Read-Only Expansion Sprint。你跟團隊自主推進，不要每小步問我。」

**Pre-condition (locked)**：
- W2d squash merged → main `95466f4`
- Bruce post-merge regression PASS_WITH_DEFERRED
- 14/14 hard line HELD
- 4 deferred live HTTP（T6/T7/T8/T12）仍 `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK`
- #23 仍 W3-gated DEFERRED（**本次 W3 不解封**）

---

## §1. Sprint Goal

把已完成的 quote tick + bidask + frontend sandbox 推進到「Trading Room 可用的 read-only market-data layer」，並補：
1. K-bar Phase 2（後端 + 前端 wire-up 驗證）
2. Quote API hardening（H-6 + H-9 + observability）
3. Deferred live HTTP runbook 整理（仍 deferred）

**Sprint scope**：read-only only。**不**包含：
- ❌ paper trading
- ❌ live trading
- ❌ broker execution
- ❌ /order/create touch
- ❌ #23 write-side skeleton
- ❌ deploy / merge / gateway restart / KGI relogin
- ❌ contracts mutation
- ❌ tunnel implementation
- ❌ OpenAlice broker execution

---

## §2. Sprint Lanes (overview)

| Lane | Owner | Scope | Deliverable shape |
|---|---|---|---|
| A | Elva | Sprint 治理（plan / dispatch / hard-line / deferred runbook index / closeout template） | 5 docs in `evidence/path_b_w3_read_only_2026-04-27/` |
| B1 | Jason | Quote hardening：H-6 structured logging + H-9 ring buffer eviction warning + observability | DRAFT PR + impl note + tests |
| B2 | Jason | K-bar Phase 2 backend：/quote/kbar/recover + subscribe skeleton + interval matrix + mock fallback + no-order tests | DRAFT PR + impl note + interval matrix + no-order proof |
| C | Jim | v0.7.0 sandbox real-data-ready UI（K-line + quote panel + bidask + tick + containment + order locked + indicator + fallback） | sandbox closeout + screenshots + zip + typecheck/build |
| D | Bruce | W3 verify harness 7 items（no-order matrix / K-bar verify / hardening verify / frontend sandbox verify / redaction v1 audit / wording audit / deferred runbook frozen） | verify harness + reports |
| E | Athena | HOLD（4 governance tasks 允許但不主動推） | optional governance memo |

**Lane B1 / B2 可平行**；Jason agent 可連著兩個 DRAFT PR 跑或拆兩 PR。
**Lane C 等 Lane B2 K-bar shape 出來再接通 real data**；UI 結構先 ready。
**Lane D 可平行於 B/C**：static / unit / spec 不需 implementation 完成。
**Lane E 可平行**；HOLD 不阻塞 Sprint 結算。

---

## §3. Definition of Done (Sprint level)

Sprint **DONE** 條件（全部須滿足才能 Lane A 收板）：
1. ✅ Lane B1 DRAFT PR opened（H-6 + H-9 + observability impl + tests）
2. ✅ Lane B2 DRAFT PR opened（K-bar route + interval matrix + mock fallback + no-order tests）
3. ✅ Lane C sandbox UI 收板 closeout doc + typecheck/build EXIT 0
4. ✅ Lane D 7-item verify harness package
5. ✅ Lane A 10-section consolidated closeout
6. ✅ 0 stop-line triggered（14/14 hard line HELD）
7. ✅ 4 deferred live HTTP item 仍 deferred（T6/T7/T8/T12）
8. ✅ #23 仍 W3-gated DEFERRED（不解封）
9. ✅ memory writeback：team_memory + elva_memory + jason_memory + jim_memory + bruce_memory + session_handoff + INDEX

Sprint **NOT DONE** 但仍可 surface 的情境：
- 任一 Lane B/C/D 觸 stop-line → Lane A 立即收板 + surface
- 楊董 直接調整 scope → 重新 plan

---

## §4. Sprint Risks

| Risk | Mitigation |
|---|---|
| K-bar SDK interval 不支援 1m/5m/15m/1d 全部 | Lane B2 必須出 unsupported matrix；不准硬轉 |
| Jim sandbox 無意中 import production apps/web | grep 防呆；Lane D wording audit 抓；DRAFT PR review 階段抓 |
| H-6 structured logging 不小心 log raw account / person_id / token | Lane D redaction v1 audit；strict redaction unit test |
| 4 deferred live HTTP 被誤標 PASS | hard rule 寫在 deferred runbook index；Lane D 每輪 audit |
| #23 write-side 被誤解封 | hard rule 寫在 hard-line matrix；Lane A 收板 audit |
| Jim subscribe_kbar WS 在 sandbox 跑出 production-side effect | Lane C 護欄 grep；endpoint unavailable graceful fallback 必須 default-on |

---

## §5. Sprint Cadence

- 不每小步回報
- Lane B/C/D 跑 background agents（autonomous block 模式）
- 楊董 next status check 或 stop-line trigger 才上 surface
- 6 trigger points (per 楊董 reporting cadence)：
  1. W3 DRAFT PRs ready
  2. Bruce verify package ready
  3. Jim sandbox package ready
  4. Athena governance closeout ready
  5. stop-line triggered
  6. 2-4 小時到點

---

## §6. Sprint Deliverables (Lane A 5 docs)

| # | Doc | Purpose |
|---|---|---|
| 1 | `w3_read_only_sprint_plan.md` | 本檔 — sprint plan + scope + DoD + risk |
| 2 | `w3_lane_dispatch_table.md` | Lane B1/B2/C/D/E 派工細節：scope / files allowed / files prohibited / deliverable / DoD |
| 3 | `w3_hard_line_matrix.md` | 14 條 stop-line + 10 條 not-allowed + 9 條 allowed Green+ permission；用於 Lane A 收板 audit |
| 4 | `w3_deferred_operator_check_runbook_index.md` | T6/T7/T8/T12 4 件 deferred live HTTP 的 runbook index；標 `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK`；不准跑 |
| 5 | `w3_closeout_template.md` | Lane A 9-section closeout template per 楊董 reporting cadence |

---

## §7. References

- Mission Command Mode v1.0：`memory/feedback_mission_command_mode.md`
- W2d post-merge consolidated closeout：`evidence/path_b_w2a_20260426/w2d_post_merge_consolidated_closeout_2026-04-27.md`
- main HEAD：`95466f4`
- Quote API hardening plan H-1～H-9：`evidence/path_b_w2a_20260426/jason_quote_api_hardening_plan_2026-04-27.md`
- K-bar Phase 2 feasibility：`evidence/path_b_w2a_20260426/jason_kbar_phase2_feasibility_2026-04-27.md`
- K-bar API SDK audit：`evidence/path_b_w2a_20260426/v0_7_0_kbar_api_audit.md`
- No-order guarantee checklist：`evidence/path_b_w2a_20260426/jason_no_order_guarantee_checklist_2026-04-27.md`
- Jim v0.7.0 spec：`memory/plans/jim_v0_7_0_spec.md`
- v0.7.0 sandbox：`evidence/design_handoff_2026-04-26/v0.7.0_work/`

---

## §8. System status (locked at sprint start)

- main HEAD：`95466f4`
- 系統 NOT paper-ready / NOT live-ready / NOT broker execution / NOT production trading ready
- 4 deferred live HTTP：仍 `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK`
- 14/14 hard line HELD
- #23：W3-gated DEFERRED（**不解封**）

— Elva, 2026-04-27（W3 sprint kickoff）
