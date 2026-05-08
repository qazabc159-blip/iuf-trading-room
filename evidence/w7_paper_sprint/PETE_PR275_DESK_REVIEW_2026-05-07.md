# PR #275 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：兩件事 (A) 為 Codex frontend `/lab` 補一個 `GET /api/v1/lab/strategies` alias 路由，解決 Codex 呼叫此路徑但 PR #271 只 ship 了 `/api/v1/lab/strategy-snapshot` 導致 404；(B) 新增 `GET /api/v1/briefs/:id` 接 UUID 或 date string，回傳 brief 詳情 + 完整 audit chain（hardReject / adversarialReview / hallucinationCheck）。
- 對應 sprint task：Letter D backend — BLOCK #7 Axis 1 + Brief detail with audit chain
- Base branch：main（MERGEABLE，CI 3/3 PASS）

## 2. Diff Summary
- 改了 2 個檔
- 主要改動：`apps/api/src/server.ts` +270L（alias 路由 ~30L + brief detail 路由 ~240L）；`tests/ci.test.ts` +39L（3 new tests）
- LOC: +308 / -2
- No migration needed（讀 daily_briefs + content_drafts + audit_logs 既有 tables）

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] KILL_SWITCH / EXECUTION_MODE：diff 無 toggle — PASS
- [x] place_order / submit_order / kgi.order.create：diff 無任何下單路徑 — PASS
- [x] paper sprint：無 KGI gateway 呼叫 — PASS
- [x] feature flag 預設：讀路由無 flag，N/A

### B. Auth / Secret Hygiene
- [x] 新 endpoint auth：兩個路由都先做 `READ_DRAFT_ROLES.has(role)` 檢查（line 5761 + 5812），`c.get("session")` middleware 已在 global session gate 之後 — PASS
- [x] hardcoded key/token：無 — PASS
- [x] 敏感資訊 leak：workspaceId 從 session 取，不 expose person_id / userId — PASS（見下方 Suggestion #1 關於 sourcePath）
- [x] Secret Regression Check CI：PASS

### C. State / Schema Integrity
- [x] DB schema 變更：無，純讀 — PASS
- [x] enum/status：無新增 — PASS
- [x] state machine：N/A
- [x] module-level var：無 — PASS

### D. PR Hygiene
- [x] PR title：`feat(api)` conventional commit ✓ — PASS
- [x] commit convention：N/A（squash merge）
- [x] base branch：main — PASS
- [x] PR description：列出 evidence path、測試結果、已知 gap（live curl 未跑，標 [ ]）— PASS

### E. IUF-Specific 不可越線
- [x] agent 越 lane：Pete 不修功能 — PASS；PR 只改 apps/api + tests — PASS
- [x] governance bypass：無 — PASS
- [x] KGI gateway /order/create：無 — PASS
- [x] redaction policy：無 person_id / token 明碼 — PASS

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)

**1. [Logic Bug] dedupeKey 格式錯誤 — content_draft lookup 永遠 miss，auditChain 全部 null**

- 位置：`apps/api/src/server.ts` line 5912
- 問題程式碼：
  ```typescript
  const dedupeKey = `daily_brief:${workspaceId}:${brief.date}`;
  ```
- 實際格式（`content-draft-store.ts` line 99）：
  ```typescript
  return `${input.workspaceId}:${input.targetTable}:${entity}:${producerVersion}`;
  // 實際值例子："{ws-uuid}:daily_briefs:2026-05-07:v1"
  ```
- 差異：
  - PR 用 `daily_brief`（單數），實際 table name 是 `daily_briefs`（複數）
  - PR 欄位順序是 `table:workspaceId:date`，實際是 `workspaceId:table:entityId:producerVersion`
  - PR 缺少 `producerVersion` 欄位（預設 `"v1"`）
  - `targetEntityId` 應為 date string（`brief.date`），PR 確實用的是 date，但前兩個問題已導致 key mismatch
- 後果：`draftRows` 永遠是 `[]`，`draftIds` 永遠是 `[]`，`auditRows` 永遠是 `[]`，`adversarialReview` 和 `hallucinationCheck` 永遠是 `null`。雖然 null 是 graceful fallback，但這違反了此 endpoint 的核心目的（Letter D = audit chain 可見性）。
- 建議修法：
  ```typescript
  // 正確的 dedupeKey 格式（與 computeContentDraftDedupeKey 對齊）
  const producerVersion = "v1";
  const dedupeKey = `${workspaceId}:daily_briefs:${brief.date}:${producerVersion}`;
  ```
  或直接 import `computeContentDraftDedupeKey` 並呼叫：
  ```typescript
  import { computeContentDraftDedupeKey } from "./content-draft-store.js";
  const dedupeKey = computeContentDraftDedupeKey({
    workspaceId,
    targetTable: "daily_briefs",
    targetEntityId: brief.date,
    producerVersion: "v1"
  });
  ```

### 🟡 Suggestions (should fix)

**1. [Test Quality] Test #1（alias smoke）用 `require()` 不是 `import`，且只測 consumer function 不測路由本身**

- 位置：`tests/ci.test.ts` line 8361
- 問題：`require("../apps/api/src/lab-strategy-consumer.ts")` 在 ESM + ts-node 環境裡可能 fallback 到 CommonJS require，且這個 test 實際上不驗證 `/api/v1/lab/strategies` 路由已被 app.get() 登記，只驗證 function 可被 import。路由 404 不會被這個 test 抓到。
- 建議：改用 `import` 或用 supertest 打路由。或在 test 標題加 comment 說明「此 test 為 function-level smoke，路由本身由 Bruce smoke 驗」避免誤導。

**2. [Info-leak] `sourcePath` 在 `/api/v1/lab/strategies` response 中可能 expose 本機路徑（local dev only）**

- 位置：`apps/api/src/server.ts` — alias 路由完全繼承 strategy-snapshot handler，snapshot 物件包含 `sourcePath` 欄位（lab-strategy-consumer.ts 已知 issue，PR #271 evidence 有記）
- 影響：prod/Railway snapshot=null，不 expose；local dev with Analyst role 會看到絕對路徑
- 建議：alias 路由在 return 前 strip `sourcePath`（單行 destructure 即可）

**3. [Correctness] adversarialRow 尋找邏輯用 `find()` 取第一筆，如果同一草稿有多次 adversarial audit（重試），會取最新的反而最相關**

- 位置：`apps/api/src/server.ts` line 5975
- 問題：`auditRows` 已按 `desc(auditLogs.createdAt)` 排序，`find()` 取第一筆即為最近的，邏輯上沒錯。但 comment 沒說明。建議加一行 comment 說「first row = most recent due to desc sort」，避免未來讀者懷疑。
- 影響：無 bug，純文件問題

### 💭 Nits (nice to have)

**1. HARD_REJECT_RULES 在 server.ts 和 tests/ci.test.ts 各有一份 copy，不共享 source of truth**

- 位置：server.ts line 6028 + ci.test.ts line 8378
- 影響：server 改規則清單，test 不會自動同步（test 只驗 length=6 + non-empty，不驗 text 完整性）
- 建議：export HARD_REJECT_RULES 成常數，test import 後驗 length + 每條

**2. `OPENAI_ADVERSARIAL_REVIEWER_MODEL` fallback 在 response 裡 hardcode `"gpt-4.1"` 而非讀 env var**

- 位置：server.ts line 5984（adversarialReview.reviewerModel fallback）
- 影響：如果 payload 沒有 `model` 欄位（老舊 audit log），顯示的 model name 可能不反映實際使用的 env var
- 建議：`process.env["OPENAI_ADVERSARIAL_REVIEWER_MODEL"] ?? "gpt-4.1"` 是可接受 fallback，但 .env.example 已有該 var（line 32），此條為 nit 不是 suggestion

### Praise
- alias 路由設計乾淨：完整複製 strategy-snapshot handler 而非 redirect，避免 redirect 複雜度
- workspace isolation 嚴格：每個 DB query 都帶 `workspaceId` filter
- graceful null 模式正確：audit chain 任何 layer 沒資料都回 null 而非 500；null 是 honest state
- CI 3/3 PASS，W6 No-Real-Order Audit + Secret Regression 全通
- 不 touch 任何 KGI / paper / risk / broker code，lane 邊界乾淨

## 5. Verdict

- [ ] APPROVED — 可 ready，無 blocker
- [x] NEEDS_FIX — 有 1 個 blocker，owner 修完重 review
- [ ] BLOCKED — 結構性問題，建議 close 重做

**NEEDS_FIX — 1 blocker**

Blocker #1 是 1-line 機械性修復（dedupeKey 格式），不影響架構設計。修完後其他 Suggestions 可隨 owner 判斷是否補，不構成 reblock 條件。

## 6. Suggested Owner for Fixes

- 🔴 #1 → Jason（1-line fix，dedupeKey format 對齊 computeContentDraftDedupeKey 格式）
- 🟡 #1 → Jason（test require() → import 或加 comment 說明 limitation）
- 🟡 #2 → Jason（strip sourcePath from alias response，1 line）
- 🟡 #3 → Jason（add comment to adversarialRow find() explaining desc sort）
- 💭 #1 → Jason（export HARD_REJECT_RULES as constant, post-demo backlog OK）
- 💭 #2 → Jason（comment only, not urgent）

## 7. Re-review Required

YES — 但只針對 blocker #1 的修復。Pete review scope：驗 dedupeKey 格式改為 `${workspaceId}:daily_briefs:${brief.date}:v1` 或等效的 computeContentDraftDedupeKey call。Suggestions/nits 可 self-ACK by Jason，不需 Pete re-review。

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Day 2
CI: validate PASS / W6-No-Real-Order-Audit PASS / Secret-Regression PASS (3/3)
PR base: main, MERGEABLE, CLEAN
