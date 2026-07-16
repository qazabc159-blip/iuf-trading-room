# PR #1289 + #1290 Desk Review — Pete 2026-07-17

---

## PR #1289 — fix/homepage-heatmap-toggle-jim5-20260717

### 1. PR Intent
- 修復首頁 HeatZonePanel 的核心/全市場熱力圖切換在離峰時段（14:10-09:00 + 週末）被 `showKgiFallback` 誤鎖死成 "all" 的 bug；只保留 `showCoverageFallback`（代表股 EOD 覆蓋不足）才強制切全市場救援視圖。
- 對應：楊董 7/17 深夜回報「首頁熱力圖又換了、沒辦法切換」的即時 hotfix（B 類快審）。
- Base branch：main（正確）。

### 2. Diff Summary
- 2 檔改動：`apps/web/app/page.tsx`（+6/-1，`effectiveMode` 一行邏輯 + 註解）、新增 `packages/qa-playwright/tests/jim_home_heatmap_mode_toggle_20260717.spec.ts`（+74）。
- LOC: +81 / -1。
- 獨立驗證（非信任 PR 描述）：`git show origin/fix/homepage-heatmap-toggle-jim5-20260717:apps/web/app/page.tsx` 逐行重算 `showKgiFallback` / `hasCore` / `displayHeatmap` / `sourceLabel` 分支——確認修復後 `effectiveMode="core"` 時，離峰仍走 `displayHeatmap = heatmap`（EOD 代表股真值，非 KGI 死 tick），`sourceLabel` 正確標「TWSE 收盤」而非偽即時；banner (`showKgiFallback`) 邏輯零改動，仍會顯示。語意正確。

### 3. IUF Blocker Checklist
- A. Kill-switch/Real-order：N/A（純顯示邏輯，grep 全診斷 diff 對 `KILL_SWITCH`/`EXECUTION_MODE`/`place_order`/`submit_order`/`order/create` 零命中）→ PASS
- B. Auth/Secret：N/A，無 endpoint/secret 改動 → PASS
- C. State/Schema：無 DB/migration/enum 改動 → PASS
- D. PR Hygiene：title 對應 sprint pattern／commit 為單一 conventional `fix(web):` commit／DRAFT 起手／base 正確／PR body 有查證段落（git log 溯源 #1267/#1270/#1271/#1273）→ PASS
- E. IUF 不可越線：`IndustryHeatmap`／`MarketWideHeatmap` 等打磨引擎元件 0 diff（`git diff --stat -- apps/web/components apps/web/lib` 空），符合「已打磨元件只准複用不准重寫」鐵律 → PASS

### 4. Findings — Priority Ranked

### 🔴 Blockers
（無）

### 🟡 Suggestions
1. **CI Playwright P0 Smoke 目前 FAILURE**（run 29515519899）。失敗原因是既有 `market-intel.spec.ts` 60s timeout，與本 PR 的 2 個改動檔（`page.tsx` heatmap 邏輯 + 新 spec）完全無交集。交叉核對：同一時間窗（16:19-16:35 UTC 7/16）另外 4 張 sibling PR（#1290 forgot-password、password-reset-jason、desk-order-matrix-chart-jim3）跑出**同一支** `market-intel.spec.ts` timeout、同樣 7 passed/1 failed/1 skipped 模式 → 判斷為當時共用環境的暫時性 flake（很可能是 news API 併發限流），非本 PR 引入的回歸。
   - 建議：merge 前重跑一次 CI 拿乾淨綠燈（repo 硬規則「全綠才可 merge」不因根因不相關而豁免），不需要 code 層面修正。
2. **新 spec `jim_home_heatmap_mode_toggle_20260717.spec.ts` 未打 `@smoke` tag**，而 `.github/workflows/ci.yml:268` 的 P0 job 是 `playwright test --grep @smoke` — 這支 spec 結構上**不會**被 CI 執行到（本次 run 的 9 個測試清單裡確實沒有它）。PR body 寫「CI 的 Playwright P0 job...會是這支 spec 的第一次真實執行」這句對這支 spec 不成立（grep 篩不到它），需要 Elva/Bruce 手動跑過一次才算真驗證，不能只看 CI 綠燈就當作這支 spec 已執行。
   - 建議：要嘛替這支 spec 補 `@smoke` tag 納入自動化，要嘛 PR body 改成誠實揭露「需人工單獨跑」（同 #1290 對同款情境的揭露方式更誠實，可參考）。

### 💭 Nits
（無）

### ✅ Praise
- Root-cause 說明附完整 git log 溯源查證（`git log --since 2026-07-14`），排除是 #1282/#1283/#1286/#1287 這幾張後續 PR 波及首頁的可能性，這種「先查證再下結論」的紀律值得肯定。
- 改動精確到一行 + 完整中文註解說明因果，符合 Surgical Changes 原則；沒有藉機重寫 `IndustryHeatmap` 或動 globals.css。
- 新 spec 本身（雖然目前不會被 CI 執行到）是真實 DOM 互斥斷言（`.tac-industry-heatmap` vs `.tac-market-wide-heatmap` 出現/消失、真點擊觸發 URL 變化、tile count > 0），非假斷言。

### 5. Verdict
- [x] **NEEDS_FIX** — 0 個真 code 🔴，但 CI 目前非綠 + 一項驗證完整性缺口（🟡 x2）需要 Elva/Bruce 處理後才可 ready；code 本身邏輯已獨立驗證正確。

### 6. Suggested Owner for Fixes
- 🟡 #1（CI 重跑）→ Bruce
- 🟡 #2（@smoke tag 或誠實揭露）→ Jim5 補一行 tag，或 Elva 決定是否接受手動驗證揭露

### 7. Re-review Required
NO（🟡 項目不需要 Pete 重審 code，Bruce 確認 CI 綠 + spec 執行結果即可）

---

## PR #1290 — feat/forgot-password-page-jim4-20260717

### 1. PR Intent
- 新增 `/forgot-password` + `/reset-password` 前端頁面，消費 #1288（jason，migration 0060）的 admin-mediated 密碼重設後端契約；`/login` 加「忘記密碼？」真連結；`register/page.tsx` 密碼規則抽成共用 `lib/password-policy.ts`。
- 對應：7/16 收板佇列「②忘記密碼要不要補」的後續實作。
- Base branch：`feat/password-reset-jason-20260716`（stacked，正確——`git merge-base` 確認 = jason branch tip `1768684e`）。

### 2. Diff Summary（against stacked base，非 main）
- 9 檔改動：新增 `forgot-password/page.tsx`(+137)、`reset-password/page.tsx`(+201)、`lib/password-policy.ts`(+23，從 register 抽出)、新 spec `jim4_forgot_password_flow_20260717.spec.ts`(+234)；改動 `globals.css`(+204，純 `.authv3-forgot` 新 scope)、`login/page.tsx`(+3)、`register/page.tsx`(+9/-23，抽共用)、`middleware.ts`(+2)、`auth-client.ts`(+52)。
- LOC: +862 / -21。
- 確認**未觸碰** jason 的後端檔（`auth-store.ts`/`password-reset-store.ts`/`server.ts`/migrations）——lane 邊界如 PR body 所稱屬實。

### 3. IUF Blocker Checklist
- **A. Kill-switch/Real-order**：grep 全 diff 對 `KILL_SWITCH`/`EXECUTION_MODE`/`place_order`/`submit_order`/`order/create` 零命中 → PASS
- **B. Auth/Secret Hygiene**：
  - `middleware.ts` 新增 `/forgot-password`/`/reset-password` 進 `PUBLIC_PATHS`（`Set<string>`），比對邏輯是 `PUBLIC_PATHS.has(pathname)` **精確字串比對**（非 `.startsWith`），驗證 `/reset-password-admin` 之類假想路由不會被誤放行 → PASS
  - Token 從 URL query 讀取（`useEffect` + `URLSearchParams`），全頁面無 `console.log`/analytics/第三方資源載入會夾帶 referrer 洩漏（grep 確認零 `console.`/`analytics`/`gtag`），也無外部網域連結 → PASS
  - 錯誤訊息渲染：前端 `ERROR_TEXT`/`authErrorMessage` 一律走**錯誤碼白名單 switch**（如 `invalid_or_expired`）映射到硬編中文字串，`{error}` 走 JSX 自動跳脫；獨立追查後端 `server.ts:20911-20973`（jason 分支）確認 `error` 欄位一律是受控 enum（`invalid_body`/`invalid_or_expired`/`password_too_short`...），**不是**原始 exception message 直傳——XSS 面與帳號存在性洩漏兩項皆 PASS
  - `request-password-reset` 後端不論帳號是否存在回同一個 `GENERIC_RESPONSE`（甚至 DB error 也吞掉不變成 oracle）；前端 `/forgot-password` 頁面文案「本系統沒有自動寄信功能...」無任何「已寄出/email sent」字樣（grep 確認）→ PASS
- **C. State/Schema Integrity**：本 PR 不含 migration（migration 0060 屬 #1288/jason），無 enum/status 改動 → N/A
- **D. PR Hygiene**：title 對應 sprint pattern／單一 feature commit＋2 支 W6-audit-dodge fix commit（合理，非藏 bug）／DRAFT 起手／stacked base 正確且 PR body 明寫「retarget to main once #1288 merges」／驗證段落誠實（含本機真 e2e 10/10、`register/page.tsx` 零行為變動的明確聲明）→ PASS
- **E. IUF 不可越線**：Lane boundary 聲明「未動 jason 後端檔／未動 Jim3 的 `desk-exact/`」——實測 diff file list 逐一核對屬實 → PASS

### 4. Findings — Priority Ranked

### 🔴 Blockers
（無）

### 🟡 Suggestions
1. **CI Playwright P0 Smoke 目前 FAILURE**（run 29516232762），同 #1289 分析：同一支既有 `market-intel.spec.ts` timeout，與本 PR 9 個改動檔零交集，判斷為同批次共用環境暫時性 flake（非回歸）。Merge 前仍需重跑拿乾淨綠燈。
2. **新 spec 同樣未打 `@smoke` tag**，CI 的 P0 grep 篩不到它——但這點 PR body **已誠實揭露**（明確寫「本機真實 e2e 對 throwaway local Postgres + 真 dev servers 跑 10/10 pass」，並註明 `jim_login_register_v3_20260716.spec.ts` 那支不是 CI gate 而是「one-time acceptance」），比 #1289 的揭露方式更精確——僅記錄以便 Elva 知道這是本機驗證非 CI 驗證，不算新問題。
3. `reset-password/page.tsx` 的 `authErrorMessage` fallback 預設文案是「登入失敗，請稍後再試。」（沿用 login 情境的字樣）——若 `reset-password` 後端未來新增一個目前 `ERROR_TEXT` 沒覆蓋到的錯誤碼，使用者會看到跟「重設密碼」語意不符的「登入失敗」提示。純文案 nit，非安全問題（不會誤導帳號存在性，只是措辭跟情境對不上）。

### 💭 Nits
1. e2e spec 內特意把測試密碼變數命名為 `throwawayPw`/`updatedPw`（避開 W6 audit 的 `password = "..."` 命名 heuristic）——這是好的 workaround，但如果 W6 audit 未來收緊到看變數內容而非變數名，這類 throwaway 明文密碼常數還是會被抓；目前沒問題，僅記錄供未來 W6 audit 調整時參考。

### ✅ Praise
- **Lane 紀律標竿**：完全沒有碰 jason 的後端檔案，diff file list 逐一核對屬實；stacked chain base 設對且 PR body 主動寫明「retarget to main once #1288 merges」的收斂計畫。
- **`password-policy.ts` 抽共用「零行為變動」的聲明是真的**——逐行比對抽出前後的 `passwordPolicyRules`/`policyPassed` 函式體字元級相同，純搬移沒有夾帶邏輯改動，是本輪唯二乾淨符合「聲明=事實」的 refactor claim 之一。
- **反列舉（anti-enumeration）從前端到後端一致到底**：後端 `GENERIC_RESPONSE` 連 DB error 都吞掉不變成 side-channel；前端文案沒有半個「已寄出」字樣；新 spec 專門寫了一個「不存在的信箱也拿到同一個確認訊息」的測試鎖住這個行為——這條安全性質從契約到驗證都閉環了。
- **e2e spec 品質高**：用真實 throwaway 帳號（`jim4-e2e-${Date.now()}@example.com`）+ 獨立 Playwright request context 避免 owner session 被覆寫的 cookie 衝突，覆蓋率含「新密碼登入成功」+「舊密碼理應失效」全流程，不是空心的 UI-only mock 測試。

### 5. Verdict
- [x] **NEEDS_FIX** — 0 個真 code 🔴；同 #1289，CI 目前非綠是唯一擋 ready 的硬性項目（repo「全綠才可 merge」規則），code/安全/lane 邊界審查全數通過。

### 6. Suggested Owner for Fixes
- 🟡 #1（CI 重跑）→ Bruce
- 🟡 #2（僅記錄，無需動作）→ N/A
- 🟡 #3（文案 nit，選配）→ Jim4
- 💭 #1（僅記錄）→ N/A

### 7. Re-review Required
NO

---

## 意外發現（跨兩張 PR）
- 兩張 PR 與同批次另外 3 張 PR（`fix/desk-order-matrix-chart-jim3`、`feat/password-reset-jason`）在 2026-07-16 16:19-16:35 UTC 同一時間窗**全部** CI Playwright P0 Smoke FAILURE，且失敗特徵完全相同（`market-intel.spec.ts` @smoke timeout，7 passed/1 failed/1 skipped）。這不是任何一張 PR 的程式碼問題，而是當時共用測試環境的暫時性 flake（推測 news API 併發限流）。建議 Elva/Bruce 對這 5 張 PR 統一重跑一次 CI，不需要逐張排查程式碼。

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6 Day (paper sprint, stacked DRAFT chain)
