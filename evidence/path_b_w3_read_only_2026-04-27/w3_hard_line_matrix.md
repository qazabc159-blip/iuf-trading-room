---
name: W3 Hard-Line Matrix
description: W3 Read-Only Sprint 14 stop-lines + 10 not-allowed + 9 allowed Green+ permission；用於 Lane A 收板 audit 與 Lane D verify
type: hard_line_matrix
date: 2026-04-27
runner: Elva
gate: 楊董 W3 GO
---

# W3 Hard-Line Matrix

## §1. Stop-Lines (14 條 — 觸發即停 + 立即上 surface，不等 batch)

| # | Stop-line | 偵測方法 |
|---|---|---|
| 1 | gateway crash | gateway log / Bruce static check |
| 2 | gateway restart needed | Lane B/C/D 任何 task 要求 restart → 直接停 |
| 3 | KGI relogin needed | 同上 |
| 4 | `/order/create` touched | grep `/order/create` 在 W3 PR diff |
| 5 | order path imported by W3 code | grep `import.*order` 在 W3 file changes |
| 6 | paper/live wording appears | grep `paper.?ready|live.?ready|paper.?trading|live.?trading` |
| 7 | OpenAlice broker execution touched | grep `OpenAlice.*broker|OpenAlice.*execute|OpenAlice.*order` |
| 8 | secret/account raw/token appears in new evidence | grep `account=|person_id=|token=|password=|KGI_PASSWORD` (非 redacted) |
| 9 | contracts mutation required | git diff `contracts/*.yaml` 非空 |
| 10 | deploy required | Railway / GHA / `railway up` action |
| 11 | merge required | `gh pr merge` action |
| 12 | Jim sandbox touches production app without DRAFT PR | git diff `apps/web/src/` 非空 |
| 13 | K-bar route tries to generate trading signal | K-bar handler 寫入 signal queue / order queue |
| 14 | `/position` native path touched | git diff 觸 `services/kgi-gateway/kgi_position*` 或 apps/api position route 非 containment-only |

---

## §2. Not-Allowed (10 條 — 整個 W3 Sprint 期間)

| # | Action |
|---|---|
| 1 | merge to main |
| 2 | deploy（任何環境）|
| 3 | gateway restart |
| 4 | KGI relogin |
| 5 | env / secret change |
| 6 | contracts mutation（OpenAPI / agent-bridge contracts）|
| 7 | `/order/create` touch |
| 8 | paper / live activation |
| 9 | OpenAlice broker execution |
| 10 | tunnel implementation（W2 tunnel proposal 仍 hold；W3 不解封）|

---

## §3. Green+ Allowed (9 條 — 本輪允許自主執行)

| # | Action |
|---|---|
| 1 | 開 DRAFT PR（B1 quote hardening / B2 K-bar Phase 2）|
| 2 | 寫 read-only backend implementation |
| 3 | 寫 frontend sandbox implementation（v0.7.0_work/）|
| 4 | 寫 tests（unit / integration mock / static）|
| 5 | 跑 typecheck / build / unit / static check |
| 6 | 更新 evidence / handoff / MEMORY / INDEX |
| 7 | 開 release / checklist docs |
| 8 | 做 no-order guarantee grep |
| 9 | 做 redaction audit |

---

## §4. Sub-Hard-Lines for Specific Lanes

### Lane B1 (quote hardening)
- ❌ raw account / person_id / token in any log / evidence / new code
- ❌ 改 quote contract（routes 行為不變，只加 hardening）
- ❌ 影響 quote latency >2x baseline（observability 不能成 bottleneck）

### Lane B2 (K-bar Phase 2)
- ❌ K-bar 不准 import order
- ❌ K-bar callback 不准觸發 signal / order
- ❌ unsupported interval 硬轉（必須記入 unsupported matrix）
- ❌ subscribe_kbar 在 production-side 開 WS（sandbox-only / DRAFT only）

### Lane C (Jim sandbox)
- ❌ touch `apps/web/src/`（除非另開 DRAFT PR）
- ❌ 新增 order button / order route link
- ❌ paper-ready / live-ready / production-ready label
- ❌ 直接 import production backend route as live data source（W2d live `/quote/bidask` + `/quote/ticks` 已合法 W2d main，可繼續用；K-bar 等 B2 ready）

### Lane D (Bruce QA)
- ❌ 跑 live HTTP T6/T7/T8/T12
- ❌ 要求 operator window
- ❌ 跑 production smoke

### Lane E (Athena)
- ❌ 任何 paper / live activation
- ❌ TR activation request
- ❌ exp003 → approved strategy 跨界

---

## §5. #23 Special Hard-Line

**#23 W3-gated DEFERRED — 本次 W3 Sprint 不解封。**

包含但不限於：
- ❌ kgi-broker write-side skeleton
- ❌ /order/create endpoint
- ❌ /order/* any route
- ❌ paper order
- ❌ execution route
- ❌ real order
- ❌ OpenAlice broker execution

**解封 trigger**：必須由楊董逐字明確授權「W3 broker write-side 解封」或「啟動 W4 broker write-side」。

---

## §6. 4 Deferred Live HTTP Hard-Line

T6 / T7 / T8 / T12 在 W3 Sprint 期間仍標 `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK`。

**不准**：
- ❌ 寫 PASS / done
- ❌ 偷跑（即使 gateway up）
- ❌ 要求 operator window（除非已整理 runbook 給 Elva 並由 Elva 上呈楊董）

**允許**：
- ✅ 整理 runbook（`w3_deferred_operator_check_runbook_index.md` 已開）
- ✅ 補 spec / pre-condition / curl / expected / fail criteria

**解封 trigger**：楊董逐字「operator window ready，補 W2d deferred live HTTP」。

---

## §7. Audit Cadence

- Lane D 每完成一個 verify item 跑 stop-line scan
- Lane A 收板前跑全 14 stop-line audit + redaction + wording audit
- 任一 Lane 觸 stop-line → 立即停 + Lane A 上 surface 給楊董

---

## §8. Sprint State Snapshot (locked)

| 項 | 狀態 |
|---|---|
| main HEAD | `95466f4` |
| 4 deferred live HTTP | `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK` |
| #23 | W3-gated DEFERRED |
| Hard line count (W2d→W3) | 14 + 10 not-allowed + 9 Green+ allowed |
| 系統狀態 | NOT paper-ready / NOT live-ready / NOT broker execution / NOT production trading ready |

— Elva, 2026-04-27 W3 kickoff
