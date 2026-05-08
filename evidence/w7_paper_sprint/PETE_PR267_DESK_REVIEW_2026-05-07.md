# PR #267 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：新增 `openalice-event-rule-engine.ts`（10 條規則、5min cron、1h dedup、`iuf_events` table）+ 4 個 REST/SSE alert endpoints。Upgrade OpenAlice from passive daily-brief producer to active event-push system。
- 對應 sprint task：BLOCK #6 Jason BG 第三輪 Ship B+C — event engine + alert endpoints
- Base branch：main（直接接，非 stacked）

## 2. Diff Summary
- 改了 5 個檔：`openalice-event-rule-engine.ts`（新建 ~420L）、`server.ts`（+128L endpoints + +17L scheduler）、`0025_iuf_events.DRAFT.sql`（新建）、`0025_iuf_events.down.sql`（新建）、`tests/ci.test.ts`（+4 tests）
- 另包含 `0024_finmind_market_intel.DRAFT.sql → .sql` rename（見 §3 C 項）
- LOC: +945 / -1

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] PASS — diff 無 KILL_SWITCH / EXECUTION_MODE toggle
- [x] PASS — diff 無 place_order / submit_order / kgi.order.create
- [x] PASS — event engine 是純 read-side（查 DB、讀 audit_log、寫 iuf_events）；不觸及任何下單路徑
- [x] PASS — R10 KGI gateway state change rule 觸發條件是 `kgi_gateway.connected / disconnected / auth_failed` audit log action；不直接呼叫 KGI gateway；kill-switch 守住
- [x] PASS — feature flag 無改動；engine tick 在 memory mode 直接 return（isDatabaseMode guard 在 runEventEngineTick 第一行）

### B. Auth / Secret Hygiene
- [x] PASS — `GET /api/v1/alerts`：`if (!session) return 401`；session middleware 已在 `/api/v1/*` 全域套用；此 endpoint 額外加 session 明確檢查 ✓
- [x] PASS — `POST /api/v1/alerts/:id/ack`：同上，session 必需
- [x] PASS — `GET /api/v1/alerts/sse`：session gate before stream construction；若無 session 直接 401，不建立 stream ✓
- [x] PASS — `POST /api/v1/internal/alerts/dispatch`：`session.user.role !== "Owner"` check → 403；Owner-only gate ✓
- [x] PASS — event payload 含 ticker / ruleId / ruleName / metric numbers；無 person_id / session / token
- [x] PASS — 無 hardcoded secret；DRAFT migration 無 sensitive data
- [x] PASS — SSE pushes events from `iuf_events` table；table payload 為 JSON metric data，無 PII

### C. State / Schema Integrity
- [FAIL] **0024 migration rename 衝突**（同 PR #266）— PR #265 already merged at 03:21 TST；`0024_finmind_market_intel.DRAFT.sql` 不再存在於 main；此 PR diff 包含相同 rename → `mergeable: CONFLICTING`
- [x] PASS — 0025 DRAFT migration：filename 含 `.DRAFT.` → migrate.ts filter 跳過 → 不會在當前 deploy 觸發；正確 DRAFT-only 狀態
- [x] PASS — `0025_iuf_events.DRAFT.sql`：`CREATE TABLE IF NOT EXISTS iuf_events`（IF NOT EXISTS ✓）、`CREATE INDEX IF NOT EXISTS`（all 3 indexes ✓）、quarantine table 有 ✓
- [x] PASS — `0025_iuf_events.down.sql` 存在且完整：`DROP TABLE IF EXISTS _quarantine_iuf_events; DROP TABLE IF EXISTS iuf_events;`（順序正確：quarantine 先刪 ✓）
- [x] PASS — engine 在 DRAFT migration 尚未 promote 時的行為：tableExists() 回 false → 所有 FinMind rules 回 [] / isDuplicateEvent 回 false / writeEvent catch 不 throw → engine 靜默 degrade，不 crash
- [x] PASS — 無 enum / status string 改動；EventSeverity `"info" | "warning" | "critical"` 與 migration CHECK constraint 一致
- [x] PASS — module-level `_engineState` 是 plain object（不含 Date/Promise），process restart 重置為 `{lastTickAt: null, lastTickEvents: 0, ...}`；無 memory leak 風險

### D. PR Hygiene
- [x] PASS — title `feat(api): event rule engine + alert endpoints (BLOCK #6 B+C)` 符合 conventional commits
- [x] PASS — PR description 詳列 10 rules table / 4 endpoints / design notes / Mike pending
- [x] PASS — base branch = main（正確）
- [x] PASS — 133/133 PASS per PR description；4 新測試（memory mode no-op / empty list / ack returns not-ok）涵蓋主要保護邊界

### E. IUF-Specific Non-negotiables
- [x] PASS — Pete 不修 production code
- [x] PASS — 無 governance bypass
- [x] PASS — 無 KGI gateway /order/create 呼叫
- [x] PASS — 0025 DRAFT migration 未 promote；Mike audit 尚未執行（PR description 明確標示 "awaiting Mike"）
- [x] PASS — evidence 無 PII

---

## 4. Findings — Priority Ranked

### Blockers

1. **[0024 DRAFT rename merge conflict]**: 同 PR #266 的問題。PR #265 merged at 03:21 TST；main 上 `0024_finmind_market_intel.DRAFT.sql` 已不存在。此 PR `mergeable: CONFLICTING`。
   - 建議：Jason rebase onto main，0024 rename hunk 自動消失，re-run CI

2. **[R02/R03 institutional rule logic 只看 foreign，未含 investment trust + dealer]**: Rule 2/3 的觸發名稱是「法人連5日同向買賣」，但 SQL 只判斷 `foreign_investors_buy_net`（外資）；investment trust（投信）和 dealer（自營商）不在 HAVING clause。用戶理解「法人」= 三大法人（外資+投信+自營），但 engine 只追蹤外資。這是 spec-drift：rule name 承諾的範圍比實際查詢廣。
   - 位置：`openalice-event-rule-engine.ts` R02 SQL HAVING clause（約 line 176）、R03（約 line 212）
   - 原因：`tw_institutional_buysell` schema 有 investment_trust_buy_net / dealer_buy_net 欄位（per FinMind spec）；只查 foreign_investors_buy_net 遺漏兩個法人分支
   - 建議：將 HAVING 條件改為同時要求 foreign + investment_trust 連續 5 日同向（dealer 較小可選加）；或將 rule name 改為「外資連5日買進/賣出」以準確描述。功能性 bug（名稱承諾 vs 實際行為不符），雖然不影響安全性，但會讓 Elva 看到錯誤觸發語義。分類為 blocker 是因為它違反 "no fake signal" 原則（rule name 是一種 signal 標籤）。

### Suggestions

1. **[0025 migration 未呼叫 Mike audit — 先不 promote]**: PR description 已明確標記 "awaiting Mike"，這是正確狀態。Elva 合併此 PR 後仍需等待 Mike audit PR 0025 DRAFT 才能 promote。確認 Mike 的 audit cadence 在這個 BLOCK 期間是否有 assigned。

2. **[R04 HHI proxy 透明度]**: Rule 4 的名稱是「籌碼集中度 HHI 突破近期高點」，但 SQL 使用 `foreign_ownership_ratio` 作為 HHI 近似值，而非真實的 Herfindahl-Hirschman index。Prompt comment 已說明「HHI approximation: use foreign_ownership_ratio as concentration proxy」。從 audit log 看，事件名稱是「籌碼集中度突破近期高點」，但實際信號是「外資持股比例突破20日高」。建議在 ruleName 加括號 `"(外資持股比例代理)"`，避免 Elva/楊董 誤解為真 HHI 計算。

3. **[SSE push 每15秒主動 pull unreadOnly events]**: SSE endpoint 每 15s 做一次 `listEvents({ unreadOnly: true })` DB query，這在高頻使用下（多個瀏覽器連接）會產生 N * 15s polling 的 DB load。目前 event volume 很低（paper sprint），不是緊急問題。未來如有多 client 連接建議切換為 event-driven 推播（notify/listen 或 simple in-process EventEmitter）。

4. **[R07 announcement window 30min 與 event engine tick 5min 有 gap 風險]**: R07 查詢 `announced_at >= NOW() - INTERVAL '30 minutes'`。如果 engine tick 在 T 時刻跑，下一次在 T+5min，R07 的 30min window 覆蓋 T-30 到 T。任何在 T-5 到 T-0 之間進 DB 的 announcement 都會被 T 時刻的 tick 捕捉到。但如果 engine tick 有 skip（process restart、slow tick），30min window 仍可 catch 最近 30min 的 announcements，而 1h dedup 防止重複觸發。設計正確，留作文件說明。

### Nits

1. **[`tableExists()` 使用 drizzleSql.identifier]**: `SELECT 1 FROM ${drizzleSql.identifier(tableName)} LIMIT 0` — 這比裸字串插值安全（防 SQL injection 於 table name）。但 `drizzleSql.identifier` 在部分 Drizzle 版本是 undocumented helper。如果未來 Drizzle upgrade 去掉此 API 會 break tableExists。建議改為 information_schema query：`SELECT 1 FROM information_schema.tables WHERE table_name = ${tableName} LIMIT 1`（更標準）。

2. **[engine tick 30s boot delay + 5min interval — 第一次 tick 發生在 boot+30s]**: 這是刻意設計（讓 DB connection stabilise），PR description 說明清楚。No action needed，僅確認 Elva 知悉啟動後第一次 event scan 有 30s 延遲。

### Praise

- 10 條 rules 全部有 `try { ... } catch { return []; }` 包裹，任何單一 rule 的 DB query 錯誤不影響其他 rules 繼續執行。Engine 設計 resilient 到每個 rule 個體。
- `isDuplicateEvent` 在 table 不存在時 catch → return false（不阻塞）；`writeEvent` 在 table 不存在時 catch → log + continue。DRAFT migration 狀態下 engine 靜默 no-op，沒有任何 throw 冒泡。
- R08/R09/R10 使用 audit_log 作為事件來源而非額外 DB 查詢，與現有架構整合優雅，不需要 pipeline 另外打通。
- `collectEngineState` 並發查 5 個 tableExists + 1 個 audit_log tail，使用 Promise.all 並行，不阻塞彼此。
- SSE auth gate 在 stream 建立前 check，不建立再拒絕（正確：避免 resource 洩漏）。

---

## 5. Verdict
- [ ] APPROVED
- [x] NEEDS_FIX — 2 blockers：(1) merge conflict（0024 rename rebase）；(2) R02/R03 rule name vs SQL logic spec-drift（法人 vs 僅外資）
- [ ] BLOCKED

Reasoning: 架構設計正確，dedup / safe-default / DRAFT migration guard 全部到位。Blocker #1 是機械性 rebase 問題。Blocker #2 是 signal 語義 bug（rule 名稱承諾三大法人但只追外資），需要 Jason 決定：改 SQL（加 investment_trust HAVING clause）或改 rule name（明確寫「外資」）。

---

## 6. Suggested Owner for Fixes

- Blocker #1 (0024 rename conflict) → Jason：rebase origin/main，re-run CI
- Blocker #2 (R02/R03 spec-drift) → Jason：選一：(a) SQL 加 investment_trust_buy_net 條件，或 (b) ruleName / ruleId 改為「外資連5日...」
- Suggestion #1 (Mike audit timing) → Elva：確認 Mike 是否在此 BLOCK 有 0025 audit 排程
- Suggestion #2 (R04 HHI proxy label) → Jason：ruleName 加括號說明

---

## 7. Re-review Required
YES — Blocker #2（R02/R03 rule logic fix）需要 Pete 確認修改方向正確後再 approve。Blocker #1（rebase）不需要 re-review。

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint / BLOCK #6 Jason BG round 3
PR: #267 feat(api): event rule engine + alert endpoints (BLOCK #6 B+C)
Files reviewed: 5 changed (1 engine module, 1 server.ts, 2 migrations, 1 test) + 0024 rename conflict
LOC: +945 / -1
