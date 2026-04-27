---
name: W3 Deferred Operator Check Runbook Index
description: 4 件 deferred live HTTP（T6/T7/T8/T12）整理 runbook index；W3 Sprint 期間仍 frozen，不准跑；只在楊董明確 operator window ACK 時可動
type: deferred_runbook_index
date: 2026-04-27
runner: Elva
gate: 楊董 W3 GO（hard rule：deferred 仍 deferred）
---

# W3 Deferred Operator Check Runbook Index

## §0. Frozen State

**4 件 deferred live HTTP 全部仍標 `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK`：**

| # | Item | Frozen since |
|---|---|---|
| T6 | fresh / stale 5000ms threshold live | W2d merge (2026-04-27 19:23 TST) |
| T7 | symbol whitelist 422 live | 同上 |
| T8 | QUOTE_DISABLED breaker live | 同上 |
| T12 | `/order/create` 仍 409 live | 同上 |

**W3 Sprint 期間**：仍 frozen；不准跑；不准標 PASS / done / SKIPPED-but-fine。

**解封 trigger**：楊董逐字「operator window ready，補 W2d deferred live HTTP」。

---

## §1. Per-Item Runbook (frozen — 待 operator window 才可動)

每個 item 的詳細 runbook 已由 Jason 撰寫於：
**`evidence/path_b_w2a_20260426/jason_w2d_deferred_live_http_runbook_2026-04-27.md`**

本 index 只摘要 + reference。

### T6 — fresh / stale 5000ms threshold

| Field | Value |
|---|---|
| State | `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK` |
| Pre-condition | gateway up + KGI session live + operator-gated |
| Spec | quote payload `freshness=fresh` if `now - server_ts < 5000ms` else `stale` |
| Test method (when unfrozen) | curl `/api/v1/kgi/quote/bidask?symbol=2330` 兩次間隔 6s，第二次預期 `freshness=stale` |
| Fail criteria | freshness 永遠 fresh / 永遠 stale / threshold 不 ~5000ms |
| Source runbook | `jason_w2d_deferred_live_http_runbook_2026-04-27.md` §T6 |

### T7 — symbol whitelist 422

| Field | Value |
|---|---|
| State | `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK` |
| Pre-condition | `KGI_QUOTE_SYMBOL_WHITELIST` env 已設且 gateway 已 reload |
| Spec | symbol 不在 whitelist → 422 + `{ error: "SYMBOL_NOT_WHITELISTED" }`（or 等同） |
| Test method | curl 一個 whitelist 不含的 symbol，預期 422 |
| Fail criteria | 200 OK / 400 / 500 / `KGI_QUOTE_SYMBOL_WHITELIST` 未生效 |
| Source runbook | `jason_w2d_deferred_live_http_runbook_2026-04-27.md` §T7 |

### T8 — QUOTE_DISABLED breaker

| Field | Value |
|---|---|
| State | `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK` |
| Pre-condition | gateway 提供 toggle 機制（env 或 admin endpoint） |
| Spec | breaker 開 → 所有 quote routes 503 + `{ error: "QUOTE_DISABLED" }` |
| Test method | toggle on → curl `/quote/bidask` 預期 503 → toggle off → 200 |
| Fail criteria | toggle 不生效 / 200 / wrong status code |
| Source runbook | `jason_w2d_deferred_live_http_runbook_2026-04-27.md` §T8 |

### T12 — `/order/create` 仍 409 (read-only mode)

| Field | Value |
|---|---|
| State | `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK` |
| Pre-condition | gateway up |
| Spec | `/order/create` POST → 409 `{ error: "NOT_ENABLED_IN_W1" }`（或 W3 同等 read-only 拒絕碼） |
| Test method | curl POST `/api/v1/kgi/order/create` 預期 409 |
| Fail criteria | **任何非 409 都是 critical** — 立即 STOP + 上 surface Elva |
| Source runbook | `jason_w2d_deferred_live_http_runbook_2026-04-27.md` §T12 |
| ⚠️ Hard rule | T12 fail = trading-room critical incident — Lane A 立刻收板 |

---

## §2. Operator Window Pre-Check (when 楊董 ACK)

只有楊董明確「operator window ready」之後，Elva 才能：

1. 整理 operator runbook 給楊董逐步 narrate
2. 列出每一步需要的 action：
   - gateway start / restart command
   - KGI login flow（含 person_id / password / 2FA）
   - 4 件 live HTTP 順序與失敗回滾
3. **Elva 不主動跑**；操作由楊董 narrate 或 Bruce-supervised
4. 完成後寫入 `evidence/path_b_w3_read_only_2026-04-27/w3_deferred_live_http_session_<date>.md`
5. Update INDEX + handoff + memory

---

## §3. W3 Sprint 期間的合法動作

| Action | Allowed? |
|---|---|
| 讀 / 引用 deferred runbook | ✅ |
| 補 spec / pre-condition / curl example | ✅（不執行）|
| 標明 frozen state | ✅ |
| 整理 operator step-by-step（給楊董未來 ACK 用）| ✅ |
| **跑 live HTTP** | ❌ |
| **標 PASS** | ❌ |
| 要求 gateway restart | ❌ |
| 要求 KGI relogin | ❌ |

---

## §4. References

- Source runbook：`evidence/path_b_w2a_20260426/jason_w2d_deferred_live_http_runbook_2026-04-27.md`
- W2d post-merge regression (deferred section)：`evidence/path_b_w2a_20260426/bruce_w2d_post_merge_regression_2026-04-27.md` §3
- W2d consolidated closeout：`evidence/path_b_w2a_20260426/w2d_post_merge_consolidated_closeout_2026-04-27.md` §8
- Hard-line matrix：`evidence/path_b_w3_read_only_2026-04-27/w3_hard_line_matrix.md` §6

— Elva, 2026-04-27 W3 kickoff (deferred frozen)
