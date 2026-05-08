# PR #266 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：新增 `openalice-adversarial-reviewer.ts` 模組，在 7-rule AI reviewer verdict=approve 且 tier=green 之後、`approveContentDraft` 之前插入第二輪 bearish/skeptic 審查。severityScore >= 7 → intercept，改路由至 awaiting_review；< 7 → 正常 auto-approve。所有呼叫（含低分）均寫入 audit_log `action="content_draft.adversarial_audit"`。
- 對應 sprint task：BLOCK #6 Jason BG 第三輪 Ship A — Pete Follow-up Letter Part 2 spec
- Base branch：main（直接接，非 stacked）

## 2. Diff Summary
- 改了 4 個檔：`openalice-adversarial-reviewer.ts`（新建 261L）、`openalice-ai-reviewer.ts`（+42L 插入 adversarial call + audit log writer）、`tests/ci.test.ts`（+8 tests）、`.env.example`（+3L 新 env var）
- 另包含 `0024_finmind_market_intel.DRAFT.sql → .sql` rename（見 §3 C 項）
- LOC: +436 / -2

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] PASS — diff 無 KILL_SWITCH / EXECUTION_MODE toggle
- [x] PASS — diff 無 place_order / submit_order / kgi.order.create
- [x] PASS — paper sprint path 不受觸及；adversarial reviewer 是純內容審查，不接觸任何下單路徑
- [x] PASS — feature flag 預設值不變；adversarial review 無獨立 flag，依賴既有 OPENALICE_AI_REVIEWER_ENABLED；null-safe-default 確保不 block pipeline

### B. Auth / Secret Hygiene
- [x] PASS — adversarial reviewer 不新增任何 HTTP endpoint；無需 auth gate 評估
- [x] PASS — OPENAI_API_KEY 只做 boolean 存在判斷（apiKey falsy → log warning + return null）；不 log key 內容
- [x] PASS — .env.example 新增 OPENAI_ADVERSARIAL_REVIEWER_MODEL 鍵名但 value 為明文 `gpt-4.1`（model name，非 secret）；PASS
- [x] PASS — audit log payload 含 adversarialFlags / severityScore / reasoning；無 person_id / session / token 洩漏
- [x] PASS — reasoning string 來自 LLM 回傳文字（brief 內容摘要），無 PII

### C. State / Schema Integrity
- [x] PASS — 無 DB schema 變更（adversarial reviewer 只寫 audit_log，已有 schema）
- [FAIL] **0024 migration rename 衝突** — 此 PR diff 包含 `0024_finmind_market_intel.DRAFT.sql → 0024_finmind_market_intel.sql` rename。但 PR #265（fix bundle）已於 **2026-05-07T03:21Z merged**，且該 rename 同時存在於 #265 diff 中。main 目前已有 `0024_finmind_market_intel.sql`（renamed）；`.DRAFT.sql` 已不存在。此 PR 的 rename diff 現為 dead action 且造成 **merge conflict**（GitHub 已回報 `mergeable: CONFLICTING / mergeStateStatus: DIRTY`）。Owner 必須 rebase onto current main，屆時 0024 rename hunk 將自動 dropped（file 已不存在需 rename）。
- [x] PASS — 無 enum / status string 改動
- [x] PASS — `writeAdversarialAuditLog` 使用已有 auditLogs schema；payload 欄位型別相容

### D. PR Hygiene
- [x] PASS — title `feat(api): adversarial reviewer + pipeline integration (BLOCK #6 A)` 符合 conventional commits
- [x] PASS — PR description 詳述 design spec 對應、test plan、cost ACK
- [x] PASS — base branch = main（正確，非 stacked chain）
- [x] PASS — 137/137 tests PASS per PR description；8 新測試涵蓋 parseAdversarialJson 純函數（7 test cases）+ safe-default API key absent（1 test）

### E. IUF-Specific Non-negotiables
- [x] PASS — Pete 不修 production code
- [x] PASS — 無 governance bypass
- [x] PASS — 無 KGI gateway /order/create 呼叫
- [x] PASS — evidence 無 PII 洩漏

---

## 4. Findings — Priority Ranked

### Blockers

1. **[0024 DRAFT rename merge conflict]**: PR #265 merged at 03:21 TST 已將 0024 從 `.DRAFT.sql` rename 至 `.sql`。當前 PR diff 包含相同 rename，造成 `CONFLICTING` merge state。此 PR 無法直接 merge 直到 rebase。
   - 位置：`packages/db/migrations/0024_finmind_market_intel.DRAFT.sql` rename hunk
   - 原因：branch 建立時間在 #265 merge 之前；rebase onto main 後 rename hunk 消失（file 已不存在），衝突自動解除
   - 建議：`git rebase origin/main` → verify 0024 hunk dropped → force-push branch → re-run CI

### Suggestions

1. **[sourcePackSummary hardcoded null — Category C 實際效果降級]**: `fireAiReviewerForDraft` 呼叫 `runAdversarialReview(draftRow.payload, draftId, null)`，sourcePackSummary 永遠為 null。Prompt 中 Category C 的 source pack 段落會顯示 `"(source pack summary not provided)"`，LLM 對 cherry-pick bias 的判斷能力顯著降低。PR description 已說明此限制，但 Elva 應知悉：Category C in production = effectively degraded。
   - 位置：`openalice-ai-reviewer.ts:375` + `runAdversarialReview` 第三參數
   - 建議：如 pipeline 有 sourcePackContext，在呼叫 `fireAiReviewerForDraft` 時傳入。或在下一 PR 補上 `openalice-pipeline.ts` → `runAdversarialReview` 的直接路徑（那裡有 sourcePackSummary 可用）。

2. **[MAX_TOKENS=400 邊界偏緊]**: Prompt 要求 LLM 回傳 3 flags（最多 3 句） + severityScore + reasoning（2-3 句）。400 tokens 在 gpt-4.1 一般可行，但 3 flag 句子 + reasoning 的 JSON 可能逼近邊界。Score truncation 造成 JSON 不完整 → `parseAdversarialJson` 回 null → safe-default（pipeline 不 block）。雖有 safe-default 保底，但頻繁 truncation 意味著 adversarial gate 功能退化而無 log 警告。
   - 位置：`openalice-adversarial-reviewer.ts:34`（`MAX_TOKENS = 400`）
   - 建議：調整至 600（與 primary reviewer 對齊或略高）；cost delta = ~50% more output tokens，per 楊董 ACK precision > cost。

3. **[writeAdversarialAuditLog 呼叫在 severity < 7 路徑未寫 ai_yellow_held]**: 當 `adversarialResult.severityScore >= 7`，PR 正確同時寫了 `content_draft.adversarial_audit` + `content_draft.ai_yellow_held` 兩條 audit log。但 severity < 7 的路徑只寫 `adversarial_audit` 一條，未寫任何 ai-reviewer 主流程 audit。這與 `fireAiReviewerForDraft` 的 approve 路徑 audit 機制一致（approve 由 `approveContentDraft` 內部寫），不是 bug。只是 Elva 看 audit log 時需理解：`adversarial_audit` action 代表「有跑、低分、放行」；`ai_yellow_held` 代表「截停」。這份 audit 設計是正確的。留為文件 nit。

### Nits

1. **[`parseAdversarialJson` 的 `reasoning` 回退為空字串而非 null]**: 當 `parsed.reasoning` 不是 string 時，code 回退 `reasoning: ""`。空字串會寫入 audit_log。語義上 `null` 更清楚（「LLM 未提供 reasoning」）。非功能問題，只影響 audit log 讀者體驗。

### Praise

- Safe-default 設計無懈可擊：API key 缺 / fetch 失敗 / HTTP 錯誤 / JSON parse 錯誤 / missing severityScore / 未知 exception — 共 6 條失敗路徑，全部回 null，pipeline 從不被 block。比 primary reviewer 的 safe-default 更嚴謹。
- `parseAdversarialJson` 作為純函數 export，8 個 unit tests 覆蓋所有 edge cases（全 flags / 空 flags / score clamping / missing score / malformed JSON / fence stripping / flag count cap / no-API-key safe-default）。測試設計完整。
- Scoring guide (0-3 / 4-6 / 7-8 / 9-10) in prompt 讓 LLM 有明確 calibration 錨點，減少 borderline 7 的模糊判斷。
- `intercepted: boolean` 欄位在 adversarial audit log payload 中提供了 "是否被截停" 的一鍵查詢欄位，方便 Elva 統計截停率。

---

## 5. Verdict
- [ ] APPROVED
- [x] NEEDS_FIX — 1 blocker：merge conflict（0024 rename），rebase + re-push 即解，功能代碼無問題
- [ ] BLOCKED

Reasoning: 功能設計與 Pete BLOCK #6 Follow-up Letter Part 2 spec 完全對齊。IUF blocker checklist §A-B-D-E 全 PASS。唯一 blocker 是 branch stale 造成的 0024 rename merge conflict，1 行 rebase 可解。功能代碼可 approve。

---

## 6. Suggested Owner for Fixes

- Blocker #1 (0024 rename conflict) → Jason：`git rebase origin/main`，確認 0024 rename hunk 消失後 force-push，re-run CI
- Suggestion #1 (sourcePackSummary null → Category C degraded) → Jason：下一 PR 補 openalice-pipeline.ts 呼叫路徑時注入
- Suggestion #2 (MAX_TOKENS 400 → 600) → Jason：1 行改動，建議與 rebase 一起提交

---

## 7. Re-review Required
NO — 功能無 blocker。Rebase 後 Elva 可直接 merge（merge conflict 是機械性問題，不需要 Pete 重看功能邏輯）。

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint / BLOCK #6 Jason BG round 3
PR: #266 feat(api): adversarial reviewer + pipeline integration
Files reviewed: 4 changed (2 production modules, 1 test, 1 env doc) + 1 migration rename (conflict)
LOC: +436 / -2
