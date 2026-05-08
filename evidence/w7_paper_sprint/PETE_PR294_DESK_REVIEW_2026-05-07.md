# PR #294 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：三件事打包
  1. RED-1 fix：`evaluatePipelinePublishGate()` 之前是 orphaned（Pete BG audit 發現），現在 wire 進 `fireAiReviewerForDraft` adversarial 通過後、`approveContentDraft()` 之前
  2. RED-2 fix：`BROKEN_TOKEN_PATTERN` 從 inline local var → module-level export，讓測試和外層能直接參照
  3. Bruce gap report 13 vendor endpoints：`/meta` `/sources` `/quotes` `/breadth` `/heatmap` `/openalice/status` `/paper/e2e` `/finmind/health` `/portfolio/preview` `/vendor/strategy/ideas` `/dashboard/snapshot` (plus lab/three-strategy/* 14 endpoints bundled from PR #291 base commit)
- 對應 sprint task：BLOCK #9 lab→TR + Pete RED-1/RED-2 + Bruce gap P0+P1
- Base branch：main（fork at `af4f52d`）

## 2. Diff Summary
- 改了 7 個檔：
  - `apps/api/src/lab-three-strategy-consumer.ts` (new, 401L)
  - `apps/api/src/openalice-ai-reviewer.ts` (+91L)
  - `apps/api/src/openalice-pipeline.ts` (+14L)
  - `apps/api/src/server.ts` (+897L)
  - `data/lab/three-strategy/three_strategy_paper_fixture_api_snapshot_v1.json` (new, 2197L)
  - `data/lab/three-strategy/three_strategy_paper_fixture_loader_manifest_v1.json` (new)
  - `tests/ci.test.ts` (+288L)
- LOC: +3888 / ~0 deletions (all additive)

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [A1] grep 全 diff：`KILL_SWITCH` / `EXECUTION_MODE` toggle — PASS。`getExecutionFlagSnapshot()` 只讀取 flags 不改寫；`paper/e2e` endpoint 讀 `killSwitchEnabled` 顯示 state，無 toggle。
- [A2] grep 全 diff：`place_order` / `submit_order` / `kgi.order.create` — PASS。無任何下單路徑。
- [A3] paper sprint：所有下單路徑走 `POST /api/v1/paper/orders` — PASS。新 endpoints 全部 GET read-only。
- [A4] feature flag 預設值 — PASS。`formalOrder.state: "blocked"` hardcoded；`cash_order_path: "BLOCKED_until_Yang_final_manual_ACK"` hardcoded。Kill-switch 守住。

### B. Auth / Secret Hygiene
- [B1] 新 endpoint auth：所有 13 vendor endpoints + 14 lab/three-strategy endpoints 均有 `READ_DRAFT_ROLES.has(role)` gate，在 session middleware 之後。Auth by construction 確認 PASS。
- [B2] hardcoded API key / token — PASS。`FINMIND_API_TOKEN` 只出現為 `tokenPresent` boolean。`finmind/health` response 只回傳 `tokenPresent: boolean`，不回傳 token string。
- [B3] env var `.env.example` — N/A（無新 env var）。
- [B4] log/response body PII leak — PASS。`person_id`/`userId`/`sessionId` 無洩漏。strategy 資料的 `stripInternalFields()` 會清除 token/password/secret/api_key 欄位。

### C. State / Schema Integrity
- [C1] DB schema 變更有 migration — N/A（無 schema 變更）。
- [C2] enum / status string 同步 — PASS。vendor lowercase status enum (`live/stale/empty/blocked/error/review`) 是 adapter layer，不改 DB enum。
- [C3] state machine LEGAL_TRANSITIONS — N/A。
- [C4] runtime state process restart 風險 — PARTIAL。`lab-three-strategy-consumer.ts` 有 module-level `_cached` var，process restart 會清空 cache，但 fallback 是重新讀 file（deterministic）；不影響正確性。

### D. PR Hygiene
- [D1] PR title — PASS。`feat(api): wire RAG gate + BROKEN output scan + vendor 13 endpoint align (Pete RED + Bruce gap)` 清楚。
- [D2] commit message conventional commits — PASS。`feat(api):` 前綴。
- [D3] stacked DRAFT chain：base branch = main — PASS（直接 base main）。
- [D4] PR description evidence / known gap — PASS。PR 描述列出 RED-1/RED-2/vendor gap。

### E. IUF 不可越線
- [E1] agent 越 lane — PASS。Pete 只寫 review evidence，不動 code。
- [E2] governance bypass — N/A。
- [E3] KGI gateway `/order/create` — PASS。無任何 `/order/create` 呼叫。`quotes` endpoint 直接回傳 `sourceState: "empty"` 因為 KGI blocked。
- [E4] redaction policy — PASS。無 person_id / token 明碼。

---

## 4. Findings — Priority Ranked

### RED Blockers (must fix before merge)

**RED-MERGE: Merge conflict — rebase required**

- 位置：全 PR (`mergeStateStatus: DIRTY, mergeable: CONFLICTING`)
- 原因：PR branch 的 base commit `f74f981` = "feat(api): consume lab three-strategy paper fixture API (BLOCK #9)" — 這個 commit 已經以 squash merge (`882c437`) 進了 main (PR #291)。PR branch fork at `af4f52d`，而 main 已有 3 個新 commit（#291 `882c437`、#292 `122c2cf`、#293 `d805748`）。`f74f981` 和 `882c437` 是相同內容的 double-apply，GitHub 判 CONFLICTING。
- 修法：owner `git rebase origin/main`，`f74f981` 的 hunk 因為已在 main 而 auto-drop，只保留 `56576f9`（RED-1/RED-2/vendor 新增）的 delta。
- 注意：這是純 mechanical conflict，functional code 全部 APPROVED。

---

### 功能性問題 — 0 blockers

無功能性 blocker。

---

### RED-1 Wire 驗證結果 — PASS

`evaluatePipelinePublishGate` 正確 wired 位置：

```
adversarialResult.severityScore < 7 OR adversarialResult === null
  → evaluatePipelinePublishGate(draftId, null)  [NEW]
    ↓
    rejected → write content_draft.ai_rejected, return
    queued_for_review → write content_draft.ai_yellow_held, return
    published → write content_draft.ai_approved, return  [gate already called approveContentDraft internally]
    skipped → fall through to direct approveContentDraft
    throw → catch → fall through to direct approveContentDraft
  → approveContentDraft(...)  [original path, reached only when gate skipped/threw]
```

branch 確認：
- `rejected` 分支：寫 `content_draft.ai_rejected` + `return`（不呼叫 approveContentDraft）PASS
- `queued_for_review` 分支：寫 `content_draft.ai_yellow_held` + `return`（不 approve）PASS
- `published` 分支：寫 `content_draft.ai_approved` + `return`（gate 已 approve，不重複）PASS
- `skipped` 分支：fall through → approveContentDraft（safe default）PASS
- `catch` 分支：console.warn → fall through → approveContentDraft（safe default）PASS

一個需要注意的細節：`gateResult.action === "published"` 分支——gate 內部呼叫了 `approveContentDraft`，這個分支也寫了 `content_draft.ai_approved` audit log，但 `approveContentDraft` 本身也可能寫 audit log，造成雙寫可能性。不影響正確性（幂等），標為 suggestion。

sourcePackSummary 仍傳 `null` 給 evaluatePipelinePublishGate（因為 jobSourcePackSummaryMap 存的是 summary string 不是完整 SourcePack），RAG 2-pass 降級到 single-pass fallback。這是已知 limitation（Category C blind），與 PR #273/#282 carry-forward issue 一致，不是 regression。

### RED-2 Export 驗證結果 — PASS

`BROKEN_TOKEN_PATTERN` 從 local inline 改為 module-level export:

```typescript
// openalice-pipeline.ts
export const BROKEN_TOKEN_PATTERN = /\[(?:BROKEN(?:-\d+)?|DEPRECATED|ORPHAN)\]/i;
```

gate 內使用:
```typescript
if (BROKEN_TOKEN_PATTERN.test(draftPayloadStr)) { ... }
```

NON_PRODUCTION_SOURCE_PATTERN（input filter）仍為獨立 pattern，BROKEN_TOKEN_PATTERN（output scan）獨立使用。兩層 defense 分離 — PASS。

L2 scan 仍掃 draft payload（`JSON.stringify(draft.payload ?? "")`）這是 LLM 生成的 draftContent，確認是 OUTPUT scan，不是 input scan — RED-2 的根本問題已修正。

`[placeholder]` 仍未加入 BROKEN_TOKEN_PATTERN（PR #273 Suggestion 仍未解）— 標為 suggestion。

### Vendor 11 Endpoint Spot-check — PASS with notes

| Endpoint | 驗證結果 |
|---|---|
| GET /meta | PASS — `nowText` Taiwan formatted, `formalOrder.state: "blocked"`, `operator: "IUF-01"`, `mode` 根據 executionMode label |
| GET /sources | PASS — 8 fixed keys 順序符合 Bruce spec (`finmind/kline/company/openalice/topic/strategy/signal/news`); `news` honest empty; token never returned; IUF uppercase → vendor lowercase via `mapToVendorStatus()` |
| GET /quotes | PASS — KGI blocked → `sourceState: "empty"`, 0 fake data, honest empty arrays |
| GET /breadth | PASS — derives from OHLCV CTE if DB available; `up/flat/down/total/asOf`; degraded returns zeros |
| GET /heatmap | PASS — `sourceState` wrapper; `tiles: [{sym,name,pct,mcap}]`; `source != 'mock'` filter; mcap=null (no tw_market_value yet, honest) |
| GET /openalice/status | PASS — `runner/dispatcher/queue/publishedToday/sourceTrail/aiReview/pipeline[5]/notice`; pipeline 5-item array confirmed |
| GET /paper/e2e | PASS — 6 PaperStep items; kill-switch aware (`submitGateOpen = !killSwitchEnabled`); table existence check; audit log count |
| GET /finmind/health | PASS — path 對齊 vendor expected; `tokenPresent` boolean not token string; `quotaTotal`/`quotaUsed`; `requests[]` — partial (只存最近1次，not 5) |
| GET /portfolio/preview | PASS — `cash`/`positions`/`readiness:"preview-only"`/`note`; 用 `PAPER_BROKER_INITIAL_CASH` env var fallback 20000 |
| GET /vendor/strategy/ideas | PASS — vendor path `/api/v1/vendor/strategy/ideas` 獨立（不與 `/api/v1/strategy/ideas` 衝突）; confidence 0-1 → 0-100 mapping; stance 中文標籤; gate 基於 signals staleness |
| GET /dashboard/snapshot | PASS — aggregation Path A; structural placeholders with `_note`; honest empty sub-panels |

### Jason 假設問題 — Pete 判斷

`/api/v1/vendor/strategy/ideas` vs `/api/v1/strategy/ideas`:
- Jason 選擇了分開路徑 (`/api/v1/vendor/strategy/ideas`)。
- 判斷：CORRECT。Hono 不允許相同 path + method 雙 handler；query param transform (`?vendor=1`) 的設計讓既有 endpoint 的消費者無預期 break risk。Vendor frontend 走 vendor path，explicit 且 clean。不需要 query param transform。

---

### Suggestions (should fix)

1. **audit log double-write on gate published path**：`gateResult.action === "published"` 分支：ai-reviewer 寫 `content_draft.ai_approved`，但 `evaluatePipelinePublishGate` 內部的 `approveContentDraft` 也可能寫 audit entry。不影響正確性但造成雙條記錄。建議：`published` 分支只讀 gate 的已有 log，不額外寫；或在 gate 內部 skip the ai_approved write（讓 ai-reviewer 統一寫）。
   - 位置：`openalice-ai-reviewer.ts` L487-498
   - Owner：Jason

2. **`[placeholder]` 未加入 BROKEN_TOKEN_PATTERN**：`NON_PRODUCTION_SOURCE_PATTERN` (input filter) 包含 `\bplaceholder\b`；`BROKEN_TOKEN_PATTERN` (output scan) 不包含。L1/L2 非對稱——carry-forward from PR #273 Suggestion.
   - 位置：`openalice-pipeline.ts` — BROKEN_TOKEN_PATTERN regex
   - Owner：Jason

3. **`finmind/health` requests[] 只有最新 1 筆，vendor spec 期待 5 筆**：IUF 只存 aggregate stats（lastFetchTs 是 scalar），無法重建最近 5 次 request list。返回 1 筆是 honest degradation，但 vendor spec 明確說 `requests[5]`。建議在 field 旁加 comment 或在 response 加 `_note: "IUF stores aggregate only; requests array has max 1 entry"` 讓 Codex 可以處理 UI fallback。
   - 位置：`server.ts` /api/v1/finmind/health handler
   - Owner：Jason

4. **`/dashboard/snapshot` sub-panel 全是空 placeholder**：`sources: []`, `breadth: { up:0, ... }`, `heatmap: []` 等。與其他 sub-endpoint 資料不一致（`/breadth` 實際有 DB query）。建議 snapshot 改為 parallel-fetch 或 add `_note` 說明「call sub-endpoints for real data」（已有 `_note` field — PASS，但可以更明確）。低優先。
   - 位置：`server.ts` /api/v1/dashboard/snapshot handler
   - Owner：Jason（optional）

---

### Nits (nice to have)

1. `void sourceJobId` 抑制 unused-var lint（L515）— 稍微 hacky；可以直接移除 `sourceJobId` 變數聲明（實際上 comment 裡用到它作文件解釋，但 `draftRow.sourceJobId` 可以直接在 comment 裡引用）。
2. `lab-three-strategy-consumer.ts` 的 `_cached` module-level var 在 Railway process restart 時 reset，但 `readFileSync` 是 sync 讀 embedded file，首次讀取 fast。不需要 concern，但 comment 可以說明「cache is ephemeral; file is the source of truth on restart」。

---

### Praise

- RED-1 fix 的 5 個分支處理非常完整：rejected / queued_for_review / published / skipped / throw 全部覆蓋，且 safe-default = fall through to approveContentDraft（不 block pipeline）。這是正確的 IUF defensive posture。
- `stripInternalFields()` 在 signals/paper-orders/positions/risk-events 全部清理 credential fields，且 pattern list 明確（password/token/secret/credential/api_key/model_name/sprint_id）。
- `/api/v1/quotes` honest empty response 做得很好：`sourceState: "empty"` 而非假造 TWII 數字，符合 IUF no-fake-data 硬規則。
- Vendor status enum adapter `mapToVendorStatus()` 集中管理 IUF uppercase → vendor lowercase mapping，避免每個 handler 散落轉換邏輯。
- 175 test + 15 new tests for three-strategy + RED-2 pattern tests — 全覆蓋。

---

## 5. Verdict

- [x] **NEEDS_FIX** — 1 blocker（merge conflict）；owner rebase onto main after `d805748`。Functional code APPROVED。0 functional blockers。

---

## 6. Suggested Owner for Fixes

- RED-MERGE → Jason：`git rebase origin/main` on branch `feat/api-rag-wire-broken-scan-vendor-13-endpoint-2026-05-07`。`f74f981` hunk auto-drops（已在 main as #291）。
- Suggestion #1 (audit double-write) → Jason（low urgency，不影響 correctness）
- Suggestion #2 ([placeholder] gap) → Jason（PR #273 carry-forward）
- Suggestion #3 (finmind requests[5]) → Jason（cosmetic fix or Codex handles in frontend）
- Suggestion #4 (dashboard empty) → Jason（optional）

---

## 7. Re-review Required

NO — merge conflict 是 purely mechanical（rebase + f74f981 hunk drops）。No functional re-review needed. After rebase, Jason can mark ready and Elva can merge.

---

Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Day 8
