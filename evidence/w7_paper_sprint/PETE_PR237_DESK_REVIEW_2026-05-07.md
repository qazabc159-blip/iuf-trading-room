# PR #237 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 把首頁從「舊資訊牆（themes/signals/runs）」改成「交易工作流 cockpit」
- 接入 FinMind、市場資料、OpenAlice daily brief、paper health、strategy/quant 共 5 個 panel
- 移除 stale themes / signals table；重大訊息欄明確顯示 EMPTY 占位，不填假資料
- PageFrame 共用 code label 修正為可讀繁中
- 對應 sprint task：W7 product truth + 首頁 cockpit 升級
- Base branch：main

## 2. Diff Summary
- 改了 5 個檔案：apps/web/app/page.tsx、globals.css、components/PageFrame.tsx、2 個 evidence md
- page.tsx: +320/-473（主體重寫）；globals.css: +53/-0（新 command-card / workflow-grid 樣式）；PageFrame.tsx: +4/-4（label 修正）
- LOC: +462 / -524

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- KILL_SWITCH / EXECUTION_MODE toggle: PASS — diff 無任何此類改動
- place_order / submit_order / kgi.order.create grep: PASS — 0 hits in additions
- /order/create: PASS — 無 KGI gateway 呼叫
- feature flag 預設: PASS — 無新 flag；重大訊息欄預設 EMPTY（明確不接資料）

### B. Auth / Secret Hygiene
- 新 endpoint 走 session middleware: PASS — 本 PR 無新 API endpoint，純前端 page
- hardcoded API key / token / password: PASS — token 只做 boolean presence 顯示
- env var 公開: N/A — 前端無新 env var
- log/response leak person_id / sessionId: PASS — 無 leak

### C. State / Schema Integrity
- DB migration: N/A — 無 schema 變更
- enum / status 同步: PASS — DailyBriefDashboard 4 state 是 page-local type，無需 contracts 同步
- LEGAL_TRANSITIONS: N/A — 無 state machine 改動
- runtime state (module-level var): PASS — 無 mutable module-level state

### D. PR Hygiene
- PR title: PASS — fix(web): conventional commits format
- commit message: N/A (Codex auto-loop PR)
- stacked chain: PASS — base=main，non-stacked standalone PR
- evidence path: PASS — codex_homepage_workflow_repair_2026-05-06.md 存在且完整

### E. IUF-Specific 不可越線
- agent 越 lane: PASS — Pete 未修 code；Codex 只改 apps/web
- governance bypass: PASS — DRAFT 狀態正常
- KGI gateway /order/create: PASS — 完全無呼叫
- redaction policy: PASS — 無 person_id 明碼、無 token 明碼

## 4. Findings — Priority Ranked

### Blockers (0)
None.

### Suggestions (2)

1. **[State semantic gap] Hero stat 用 brief.state (LoadState.state) 當 tone 依據，但 panel 內用 briefUiState**
   - 位置：page.tsx hero section line 362
   - 現狀：hero 的「每日簡報」stat 用 `stateTone(brief.state)`，其中 `brief.state` 是 LoadState 的頂層 state（LIVE/EMPTY/BLOCKED），不是 DailyBriefDashboard.state（PUBLISHED/AWAITING_REVIEW/MISSING/BLOCKED）。Panel 內正確用了 briefUiState 映射。
   - 影響：若 brief load 成功但 DailyBriefDashboard.state = MISSING，hero stat tone 會顯示 gold（EMPTY），與 panel 內 briefUiState 的 gold 一致，所以視覺上不會出錯。但語義不一致（一個在 LoadState 層、一個在 domain 層），日後 MISSING 改成 error state 會靜默出現 tone 不一致。
   - 建議：hero stat 統一用 `stateTone(briefUiState)` 或從 panel helper 回傳 tone。Owner: Codex / Jim

2. **[Cockpit vs cosmetic 邊界] strategyPanel 量化研究 card 寫死「等待 Athena bundle 與 Bruce harness」**
   - 位置：page.tsx strategyPanel line ~290
   - 現狀：card 內 `small` 寫「未核准前不顯示勝率、報酬、權益曲線」— 這是誠實的 caveat，但同一個 card 的 `strong` 寫「等待 Athena bundle 與 Bruce harness」是把內部 sprint 狀態暴露在 UI 上。
   - 影響：對 operator 本人可接受，但若外部訪客看到首頁會看到內部 sprint 詞彙。
   - 建議：strong 改為「研究包尚未核准，不顯示績效」；sprint 狀態留在 /lab page。Owner: Codex

### Nits (2)

1. **loadDailyBriefDashboard emptyReason 參數語義**：`load()` 第 5 個參數 emptyReason 傳入「今天尚未發布每日簡報。」，但 isEmpty = `(value) => value.state === "MISSING"`，AWAITING_REVIEW 時 isEmpty = false，所以 emptyReason 只有 MISSING 時觸發。沒 bug，但 emptyReason 跟 DailyBriefDashboard.reason 欄位有點重複。可接受。

2. **datasets.slice(0, 14)** 硬截：若後端未來超過 14 個 FinMind dataset，首頁不會顯示全部。截斷不帶任何「還有 N 個」提示。建議加「另有 N 個」提示文字，但不阻擋 merge。

### Praise
- product truth 做到位：重大訊息欄明確 EMPTY 而非填假面板；勝率/Sharpe/equity curve 明確標示「待核准」不顯示。
- DailyBriefDashboard 4-state 設計（PUBLISHED/AWAITING_REVIEW/MISSING/BLOCKED）語義清晰，比上一版 ops snapshot 推斷更精確。
- loadFinMindDashboard 改成 Promise.all + diagnostics fail-soft（`.catch(() => null)`），比舊版 Promise.allSettled + 複雜重建邏輯更簡潔，符合 Simplicity First。
- FinMind token 只顯示 boolean presence，從不印 token 值，符合 secret hygiene。
- 重大訊息/news 欄顯式占位 + 給 /market-intel link，正確傳達「後端尚未上線」而不是消失或假填。

## 5. Verdict
- [x] APPROVED — 0 blocker；2 suggestions 不阻擋 merge；2 nits

## 6. Suggested Owner for Fixes
- Suggestion #1 (brief.state vs briefUiState tone 不一致) → Codex（1 行修正）
- Suggestion #2 (sprint 詞彙外露) → Codex（copy 修正）

## 7. Re-review Required
NO — suggestions 屬 polish，可 post-merge 修。blocker checklist 全 PASS。

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 paper sprint
