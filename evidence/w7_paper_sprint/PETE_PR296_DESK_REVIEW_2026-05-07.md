# PR #296 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：新增 4-layer risk gate (`paper-four-layer-risk-gate.ts`) 作為 paper/preview/submit 的前置風控層；同時修復 #292 遺留的 audit-stats SQL bug（paper_submit action string 從不存在的 `paper.order.submit` 改為正確的 `paper_submit`）。
- 對應 sprint task：5/12 KGI 解凍前的 risk pre-requisite（P0-3）
- Base branch：`main`（MERGEABLE: CLEAN）

## 2. Diff Summary
- 改了 4 個檔：
  - `apps/api/src/paper-four-layer-risk-gate.ts`（NEW, 239L）
  - `apps/api/src/audit-log-store.ts`（+16L：AuditAction 型別 + 2 specialAuditRoutes entries）
  - `apps/api/src/server.ts`（+67L：import + preview/submit wire + audit-stats SQL fix）
  - `tests/ci.test.ts`（+351L：+11 tests）
- LOC: +673 / -12

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] A1 — grep diff：無意外 toggle `KILL_SWITCH` / `EXECUTION_MODE`。L3 auto-engage `_setKillSwitchEnabled(true)` 是設計行為，不是意外；且 isPreview=true 路徑已做 guard 不觸發。PASS
- [x] A2 — grep diff：無 `place_order` / `submit_order` / `kgi.order.create`。PASS
- [x] A3 — paper sprint 期間所有下單路徑走 `POST /api/v1/paper/orders` 家族；無打 KGI gateway。PASS
- [x] A4 — 新 env vars (RISK_MAX_POSITION_PCT/RISK_DAILY_LOSS_PCT/RISK_PER_SYMBOL_MAX_PCT) 預設值均為保守閾值（30/2/30），不是 0 或無限大。kill switch 預設仍 ON (PAPER_KILL_SWITCH 未動)。PASS

### B. Auth / Secret Hygiene
- [x] B1 — 新 endpoint 無，`/paper/preview` 與 `/paper/submit` 均已有 session middleware；新 gate 從 `c.get("session")` 拿 session。PASS
- [x] B2 — diff 全文無 hardcoded API key / token / password / cookie。PASS
- [x] B3 — 新 env vars (RISK_MAX_POSITION_PCT 等) 未出現在 `.env.example`。→ 見 Suggestions #1。
- [x] B4 — log / response body 無 leak person_id / userId / sessionId。PASS

### C. State / Schema Integrity
- [x] C1 — 無 DB schema 變更，無 migration needed。PASS
- [x] C2 — `AuditAction` 型別新增 `paper_submit` / `paper_preview`；無 enum 同步需求（pure TypeScript type union）。PASS
- [x] C3 — 無新 status 進入 state machine。PASS
- [x] C4 — 新 module 無 module-level 可變 runtime state（env readers 每次呼叫讀 process.env，無 cached module-level var 新增）。`execution-mode.ts` 的 `_killSwitchEnabled` 模組級 var 是既有設計，L3 auto-engage 使用其 setter。PASS

### D. PR Hygiene
- [x] D1 — PR title 符合 `feat(api): ...` conventional commit 格式；對應 5/12 sprint task。PASS
- [x] D2 — Conventional commits 格式。PASS
- [x] D3 — stacked DRAFT chain：base = `main`，MERGEABLE: CLEAN。PASS
- [x] D4 — PR description 列出 test plan / lane boundary / evidence path / post-deploy verify。PASS

### E. IUF-Specific 不可越線
- [x] E1 — lane boundary 乾淨：`risk-engine.ts` 未動、`broker/*` 僅讀 `paper-broker.ts`（read-only balance/positions）、`apps/web/*` 未動。PASS
- [x] E2 — 無 governance bypass；no force push；no DRAFT skip。PASS
- [x] E3 — 無 KGI gateway `/order/create` 任何呼叫。PASS
- [x] E4 — evidence 無 person_id 明碼 / token 明碼。PASS

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
無。

### 🟡 Suggestions (should fix)

**S1: 3 個新 risk env vars 未出現在 .env.example**
- 位置：根目錄 `.env.example`（缺）
- 原因：RISK_MAX_POSITION_PCT / RISK_DAILY_LOSS_PCT / RISK_PER_SYMBOL_MAX_PCT 有 hardcoded default（30/2/30），但 operator 部署 Railway 時不知道可調。與現有 PAPER_KILL_SWITCH / EXECUTION_MODE 同樣不在 .env.example（pre-existing pattern），但新 risk gate 是 5/12 KGI pre-requisite，建議此 PR 一起補。
- 建議：在 .env.example 加 3 行（with comment 說明 default）；或開 follow-up task。

**S2: L3 block (daily-loss 真觸發) 缺直接單元測試**
- 位置：`tests/ci.test.ts`
- 原因：測試 `preview mode does NOT auto-engage kill switch on L3 hit` 的 L3 路徑實際上使用 fresh account (PnL=0)，不能強制觸發 L3 block。沒有測試驗證：「當 daily PnL 真的超過閾值時，gate 回傳 blocked=true, layer=3, auditType=risk_block_daily_loss, killSwitchAutoEngaged=true」。
- 建議：加 1 個直接 L3 block 測試（mock 或 inject `_setRealizedPnlToday` setter），驗 kill switch 在 non-preview 模式確實 auto-engage。

**S3: market order bypass L2/L4 未文件化於 PR description**
- 位置：`paper-four-layer-risk-gate.ts` L88-92
- 原因：`referencePrice(order)` 回傳 null → L2/L4 整個 skip（`if (refPrice !== null && refPrice > 0)` guard）；已有 inline comment 說明「risk engine elsewhere handles stale_quote for market orders」，但 PR description 未提及。市場委託單完全不受 L2/L4 保護是已知設計但對 Elva 來說不透明。
- 建議：PR description 補一行說明 market order bypass 設計決策。

**S4: `paper_submit_rejected` 是否雙重計入 total 的問題（邏輯清晰度）**
- 位置：`server.ts` L9188
- 原因：`total = aiApproved + aiRejected + hallucinationReject + adversarialIntercept + paperSubmit`；`paper_submit_rejected` 被排除在 total 外（因為 rejected orders 是 paperSubmit 的子集；加入 total 會重複計算）。計算邏輯正確，但 comment 沒有說明「rejected 不加入 total 因為已含於 paperSubmit」，未來可能引發混淆。
- 建議：加一行 comment 說明 paper_submit_rejected 為子集、不加入 total。

### 💭 Nits
**N1: `equity = 1` fallback 語義模糊**
- 位置：`paper-four-layer-risk-gate.ts` L127 + L135
- `equity = 1` 是 division-by-zero 防衛。但當真實 equity 為 0（帳戶資金清零）時，`balance.equity > 0 ? balance.equity : 1` 會讓 cap 計算以 1 TWD 為基礎，任何 order notional > 0.3 TWD 都被 L2 block——等同實際 block all orders，行為安全但語義怪。建議 comment 補充說明此邊界行為。

**N2: `AuditAction` union 型別現在有 `paper_submit` / `paper_preview` 但 `audit-stats` 的 `total` 只計 `paper_submit`，`paper_preview` 從未進 total**
- 這是設計選擇（preview 不是「提交事件」），但 audit-stats response 完全不回傳 paper_preview count，令人困惑 preview hits 是否被追蹤。

### Praise
- **架構乾淨**：新 module 完全 standalone，3 imports only（contracts types + paper-broker + execution-mode），沒有拉進任何 KGI / risk-engine 依賴。
- **isPreview guard 嚴格**：L3 auto-engage kill switch 的 preview guard 雙重保護（`!isPreview && !isKillSwitchEnabled()`）——即使 kill switch 已 ON 也不重複觸發，避免 idempotency 問題。
- **Part B 修法正確**：`paper_submit` action string 配合 specialAuditRoute 修法是完整的端到端修復（store → SQL → response），前後一致。
- **fail-soft on broker unavailable**：catch block 在 paper-broker 不可用時回傳 allowed，讓 `evaluatePaperOrderRisk` 繼續處理，避免 broker 不可用時 gate 變成 hard blocker。設計決策明確且安全。
- **11 個新測試覆蓋關鍵路徑**：L1/L2/L4/sell bypass/preview no-mutation/parseAuditTarget 全有直接測試。

## 5. Verdict
- [x] **APPROVED** — 0 blockers；4 suggestions（均為 nice-to-have 或 documentation gap），不妨礙 5/12 KGI unlock pre-requisite 功能正確性。

## 6. Suggested Owner for Fixes
- S1 → Jason（.env.example 補 3 行，1 min fix）
- S2 → Jason（加 1 個 L3 block test，可 post-merge）
- S3 → Jason（PR description edit，或 post-merge comment）
- S4 → Jason（comment 一行）
- N1/N2 → Jason（comment only，post-merge backlog OK）

## 7. Re-review Required
NO — 所有 suggestions 為 documentation / test coverage gap，不影響功能正確性。Elva 可直接 merge。

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 (5/12 KGI unlock pre-requisite)
Evidence: evidence/w7_paper_sprint/PETE_PR296_DESK_REVIEW_2026-05-07.md
