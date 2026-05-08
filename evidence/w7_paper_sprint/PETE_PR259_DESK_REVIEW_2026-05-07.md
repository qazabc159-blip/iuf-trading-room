# PR #259 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：開放 `GET /api/v1/companies/:id/full-profile` 聚合 11 個 FinMind dataset 成單一 envelope，供前端公司頁一次拿齊；同時新增 `POST /api/v1/internal/openalice/hallucination-check` 供 AI reviewer pipeline downstream 使用。附帶 `theme-quality.ts` 過濾器，解決 worker producer 仍吃 BROKEN/DEPRECATED 主題的問題（本輪 BLOCK5 §3 audit 指出的 metadata leak）。
- 對應 sprint task：BLOCK #5 Phase 2 #1（Jason BG 60min PR）+ BLOCK5 §3 audit 後續修復
- Base branch：main（直接 stack 主線，非 stacked DRAFT chain）

## 2. Diff Summary
- 改了 11 個檔案
- 主要改動：
  - `apps/api/src/server.ts` +662/-0：新增 full-profile endpoint + hallucination-check endpoint
  - `apps/worker/src/jobs/theme-quality.ts` 新建 22L 過濾函式
  - `apps/worker/src/jobs/theme-quality.test.ts` 新建 20L 單元測試
  - `apps/worker/src/jobs/` 下 6 個 producer 檔：各自 import filterProductionThemeCandidates，query limit 放大後過濾
  - `evidence/` 2 個 md 更新
- LOC: +808 / -16

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [PASS] `KILL_SWITCH` / `EXECUTION_MODE` 未出現在 diff
- [PASS] `place_order` / `submit_order` / `kgi.order.create` 未出現
- [PASS] paper sprint 期間無 `/order/create` 任何呼叫
- [PASS] 無 feature flag — 全新 read-only endpoint，預設不影響任何既有開關

### B. Auth / Secret Hygiene
- [PASS] `GET /api/v1/companies/:id/full-profile`：路徑在 `/api/v1/*` middleware 保護範圍（server.ts line 302），session 自動注入；handler 首行即 `c.get("session").workspace.slug`，未登入者 session middleware 會在前面攔截
- [PASS] `POST /api/v1/internal/openalice/hallucination-check`：首行 `requireOpenAliceAdmin(c)` — Owner/Admin only
- [PASS] `OPENAI_API_KEY` 只以 `process.env["OPENAI_API_KEY"]` 讀取，log 只輸出錯誤訊息字串，apiKey 值本身未進 console.warn
- [PASS] `Authorization: Bearer ${apiKey}` 在 request header 送出，不在 response body 或 log 中暴露
- [PASS] 無 hardcoded token / password / cookie
- [PASS] `person_id` / `userId` / `sessionId` 無洩漏

### C. State / Schema Integrity
- [PASS] 無 DB schema 變更 / 無 migration
- [PASS] `FullProfileSourceState` 9 enum 值（LIVE/STALE/EMPTY/BLOCKED/DEGRADED/ERROR/MOCK/FALLBACK/CLOSED）定義完整；runtime 實際指派只用到 LIVE/STALE/EMPTY/ERROR — MOCK/FALLBACK/CLOSED 是型別安全預留，未被假造
- [PASS] enum 僅在此新型別定義，contracts package 未涉及，無需同步
- [PASS] theme-quality.ts 為純函式過濾，不改 DB state

### D. PR Hygiene
- [PASS] PR title 符合 `feat(api):` conventional commits 格式
- [PASS] base branch = main（非 stacked chain，直接推主線）
- [PASS] PR description 列出 evidence path、測試結果、已知 gap（live verify post-deploy）
- [PASS] 129/129 tests PASS，typecheck / build PASS 有記錄

### E. IUF-Specific 不可越線
- [PASS] Pete 只 review，未改任何功能檔案
- [PASS] 無 governance bypass
- [PASS] 無 KGI gateway `/order/create` 呼叫
- [PASS] 無 redaction policy 違規

---

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)

**無**

---

### 🟡 Suggestions (should fix)

**1. [Scope Creep] PR title 只說 full-profile API，實際 bundled theme-quality filter 是獨立修復**
- 位置：`apps/worker/src/jobs/theme-quality.ts` 及 6 個 producer 改動
- 原因：PR #259 標題是「expose company full-profile aggregating all 11 FinMind datasets」，但 diff 中 ~30% 行數是 worker producer 的 BROKEN/DEPRECATED 主題過濾。這是上輪 BLOCK5 §3 audit 的後續修復，邏輯獨立於 full-profile API。雖然合在一個 PR 出比較快，但 PR C bundled scope 是過去被 Pete 標記過的 anti-pattern（見 MEMORY §PR scope creep pattern）。
- 建議：目前 CI green / tests pass / 無功能衝突，不強制拆分。但 Elva 應 ACK 此 scope 組合是有意為之，並在 PR description 增加一句說明（e.g. "Bundles theme-quality filter fix per BLOCK5 §3 audit"）。

**2. [Stale Threshold Inconsistency] `marginShort` 和 `institutional` 使用 5d stale 但 `shareholding` 用 10d — 是否符合 Athena spec？**
- 位置：diff 中各 isStale 計算
- 原因：institutional（三大法人）和 margin/short 台灣交所每日更新，5d stale 合理。但 shareholding（外資持股比例）依 FinMind 實際是每日也有更新，卻用 10d stale — 偏寬鬆。且 marketValue 也用 10d，這個台灣交所同樣每日更新。
- 建議：將 shareholding 和 marketValue 的 stale threshold 從 10d 降至 5d，與 institutional/margin 一致；或在 sourceTrail 的 degradedReason 標記「staleness_threshold=10d」讓前端可以做 tooltip 說明。不是硬規則違反，但會讓 STALE badge 偏少出現，潛在誤導用戶認為資料是新鮮的。

**3. [shortChange always null] marginShort 的 `shortChange` 欄位永遠回傳 null**
- 位置：diff marginShort section，`shortChange: null`
- 原因：程式碼計算了 marginChange（融資餘額差分）但 shortChange（融券餘額差分）寫死為 null，而 `ShortSaleTodayBalance` 在 MarginRow type 中有定義，理論上可以算出來。前端若顯示 shortChange 欄位會一律拿到 null，但 schema 型別是 `number | null` 暗示應有值。
- 建議：補算 shortChange，邏輯與 marginChange 對稱；或把 type 改成不含 shortChange 欄位，避免 misleading null。這不是 blocker（null 不是假資料），但 debt 應追蹤。

**4. [OPENAI_MODEL fallback 不一致] hallucination-check 用 `gpt-4o-mini` 作 fallback，與 daily-theme-summary-producer 硬鎖 `gpt-5.4-mini` 不同**
- 位置：diff `HALLUCINATION_CHECK_MODEL = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini"`
- 原因：`openalice-ai-reviewer.ts`（既有 PR #255 版本）同樣用 `gpt-4o-mini` 作 fallback。兩者一致。daily-theme-summary-producer 硬鎖是另一個選擇。`gpt-5.4-mini` 是 Codex CLI 內部別名，非官方 OpenAI API model ID（見 openalice-ai-reviewer.ts line 22 的 E2E fail 說明）。新 endpoint 和既有 ai-reviewer 保持一致 = 合理。但 feedback_openai_model_pinned_gpt54mini 的 "lock" 意圖值得在下輪釐清：env var OPENAI_MODEL 設定值到底該填什麼才對。
- 建議：不需要在此 PR 改，但 Elva/Jason 下輪應統一 `.env.example` 的 OPENAI_MODEL 說明。

---

### 💭 Nits (nice to have)

**1. `classifySection` 泛型函式在 financial/balanceSheet/cashFlow 3 個 section 沒有被呼叫**
- 位置：`classifySection` 函式定義後，financial statement 三個 section 各自 inline 了重複的 `isStale` + `state` 邏輯，而非呼叫 classifySection
- 說明：monthlyRevenue 用了 classifySection，但 financialStatement/balanceSheet/cashFlow 都繞開了（因為它們要自訂 latest 欄位 mapping）。函式定義在，但 3/4 的用途都沒用到。不影響正確性，但 classifySection 僅有 1/4 使用率顯得過度抽象（Karpathy rule #2 Simplicity First）。

**2. `Authorization: Bearer` 直接拼 apiKey 進去，沒走 redacted wrapper**
- 說明：apiKey 不會 log，但這是一個 fetch 呼叫，如果框架層面有全局 request interceptor 或 debug log，Bearer token 可能洩漏。目前 server.ts 沒有這種 interceptor（可以確認），所以實際無風險。純粹 defensive coding nit。

**3. `rev12m = nMonthsAgoDate(12)` 但 staleDays 用 35**
- 說明：月營收 12 個月歷史，stale 門檻 35 天（略超一個月）。月營收台灣是每月中旬公布，35d 合理。但 classifySection 的 staleDays=35 不在任何 spec comment 裡說明，建議加 inline comment。

---

### Praise

- Promise.allSettled 並發 11 query 設計乾淨：任何 section 失敗都降級為 ERROR section，不 500 整個 request — 完全符合 IUF partial-data > no-data 原則。
- `experimental: true` 在 news section 的 type、runtime 賦值、error path 三處都有標記，沒漏。這是過去 PR C review 要求的，Jason 做到了。
- filterProductionThemeCandidates 一個函式套 6 個 producer，不重複，regex 集中在一處維護，測試覆蓋到 BROKEN/DEPRECATED/placeholder/priority=0 四種 pattern。
- hallucination-check endpoint 所有失敗路徑（no API key / OpenAI call fail / HTTP error / parse error / empty response）都 safe default to `verdict=OK`，不讓 downstream 因外部服務失敗而卡住。
- 無 fake data：每個 section 空資料返回 EMPTY + `degradedReason: "no_rows"`，不偽裝成 LIVE。

---

## 5. Verdict

- [x] **APPROVED — 可 ready，無 blocker**

4 個 Suggestions，0 個 Blocker。Suggestion #1（scope creep）建議 Elva ACK 後 merge；其餘 3 個可作為後續 backlog。

---

## 6. Suggested Owner for Fixes

- 🟡 #1 (scope ACK) → Elva 明示 ACK 即可，不需 code change
- 🟡 #2 (stale threshold) → Jason，下輪 hotfix 或 backlog
- 🟡 #3 (shortChange null) → Jason，下輪補算
- 🟡 #4 (OPENAI_MODEL fallback) → Elva + Jason 對齊 .env.example，下輪

---

## 7. Re-review Required

NO（Elva ACK scope 後可直接 merge）

---

Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Day 9 BLOCK #5 Phase 2
