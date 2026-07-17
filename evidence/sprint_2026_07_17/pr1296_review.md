# PR #1296 Desk Review — Pete 2026-07-17

## 1. PR Intent
- 楊董 prod 親驗抓到三件 auth 頁問題，逐一修：①TickerTape skip-list 漏 /forgot-password、/reset-password 兩頁，行情空態文字外洩 ②登入頁「忘記密碼？」連結太不顯眼，升級樣式 ③/register 無邀請碼時的空態卡改回真表單，同日楊董裁決 B「維持邀請制」後 (d1a6bd80) 邀請碼改回**必填**第一格欄位。
- 對應 sprint task：W6 paper sprint 收尾 auth 頁面小修批次，B 類快審。
- Base branch：`main`（確認一致，PR #1296 `baseRefName: main`）。

## 2. Diff Summary
- 5 個功能檔改動 + 8 張截圖 + 2 個 spec 檔（`git diff origin/main...origin/fix/auth-pages-cluster-jim-20260717 --stat`）
- 主要改動：`apps/web/lib/ticker-tape.ts`（skip-list 加兩路由）、`components/TickerTape.tsx`（註解同步）、`apps/web/app/globals.css`（連結樣式升級 + 移除 `.av3-gate`/`.av3-gatecard` 孤兒 CSS）、`apps/web/app/register/page.tsx`（拆 State A/B → 真表單常駐，邀請碼改回必填第一格）
- LOC：+207 / -173（含 2 commits：629c710b 初版 + d1a6bd80 楊董裁決 B 回退）
- 全在 `apps/web` 前端；零 `apps/api`、零 migration、零 broker 路徑

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety — PASS
- grep 全 diff 對 `KILL_SWITCH`/`EXECUTION_MODE`/`place_order`/`submit_order`/`order/create`/`kgi.order` 零命中
- 無下單路徑改動；本 PR 純 auth 頁面 UI/skip-list
- CI `W6 No-Real-Order Audit` = SUCCESS

### B. Auth / Secret Hygiene — PASS
- 無新 endpoint（本 PR 未碰 apps/api）；`/register` 送出邏輯沿用既有 `apiRegister()`，未改後端契約
- 全 diff grep 密碼/token/apikey 字面值 → 零命中，唯一疑似命中的三行是既有 CSS class 三元判斷字串（`av3-good`/`av3-bad`），非 secret
- CI `Secret Regression Check (A2)` = SUCCESS

### C. State / Schema Integrity — N/A
- 無 DB schema / migration 改動
- `inviteToken` 為 client-side local state，非跨 render 持久化，process restart 無風險

### D. PR Hygiene — PARTIAL（見 🟡 #1）
- Branch 命名符合 `fix/<主題>-<作者>-<日期>` 慣例；commit message 為 conventional `fix(web): ...`，兩次 commit 各自誠實描述變更與回退理由
- **PR title + body Summary 第 3 點仍停留在第一個 commit 的敘述**（「邀請碼變成選填 prefill」），未反映 d1a6bd80 楊董裁決 B 回退後的最終行為（邀請碼已改回必填）——見 🟡 #1
- Evidence path 有列（screenshots + 測試結果 + 已知後端 gap），已知 gap 誠實揭露

### E. IUF-Specific 不可越線 — PASS
- 未越 lane（純前端修，未碰後端/migration/strategy）
- 無 governance bypass；PR 仍為 DRAFT，未自行 merge
- 無 KGI gateway `/order/create` 呼叫
- Evidence screenshot 檔名無 person_id/token 明碼

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
無。

### 🟡 Suggestions (should fix)
1. **PR title/body 敘述落後於最終 commit**：PR 標題「open register form」與 body Summary 第 3 點「邀請碼變成選填 prefill」，皆描述的是 629c710b（第一個 commit）的行為，但 head commit d1a6bd80 已依楊董裁決 B 把邀請碼改回**必填**。目前 head 的實際行為（必填＋提示文案）跟 commit message d1a6bd80 一致、誠實，但 PR title/body 未同步更新，Elva/Bruce 若只讀 PR 描述會誤以為邀請碼仍是選填。
   - 位置：GitHub PR #1296 title + body（非檔案內 diff）
   - 建議：merge 前更新 PR title/body 反映最終「維持邀請制、必填」行為，或至少在 body 頂端加一行「已依楊董裁決 B 回退，見第二個 commit」的醒目更正（PR body 目前完全沒提 d1a6bd80 的存在）。

2. **PR body 的「已知後端缺口」段落已過時但未刪**：body 中「⚠️ 已知後端缺口：無邀請碼送出目前會被 400 擋下，需要 Jason 開放無邀請註冊才能真正打通」是針對第一個 commit（選填邀請碼）寫的；d1a6bd80 回退後此段已不適用（現在前端本身就擋下空邀請碼，不會送到後端），若不更新易誤導下一輪誰去追這個「gap」。
   - 位置：PR body ## ⚠️ 已知後端缺口 段落
   - 建議：同上，一併在 body 更新或刪除此段。

### 💭 Nits (nice to have)
1. `register/page.tsx` 邀請碼欄位的 `className={inviteToken.length === 0 ? "" : "av3-good"}`（第 247 行附近）只要有任何字元就顯示「綠色/正確」樣式，不像密碼欄位那樣做格式驗證（如非空字串即視為合法格式）。因為真正驗證仍在後端（`invalid_or_expired`/`invalid_invite_code`），前端只是視覺提示，不影響功能安全，純樣式細節。

### ✅ Praise
- 兩個 commit 的訊息本身寫得非常清楚、誠實——d1a6bd80 完整說明了「為什麼從開放註冊回退到邀請制」的架構理由（single-workspace 會漏 owner 的模擬帳本），這是本輪唯一真正該補的說明，只是沒同步到 PR title/body。
- 孤兒 CSS 清理徹底：`.av3-gate`/`.av3-gatecard` 系列被拿掉後，全 repo grep 零殘留引用，含 mobile breakpoint 段落也一併清乾淨，沒有半吊子清理。
- Skip-list 修法用的是既有 `prefix === pathname || pathname.startsWith(prefix + "/")` 判斷式，不是新加邏輯——精確、不會誤 skip 像 `/forgot-password-xyz` 這種假想的鄰近路由，也不會漏掉 `/forgot-password` 本身。
- 新增的必填校驗有對應 Playwright 測試真的驗證「不送到後端」的行為（`.av3-err-persist` 顯示錯誤、且用例特別註明 not sent as empty string），不是空泛的 UI 存在性斷言。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（0 🔴，2 🟡 為 PR 描述同步問題，建議 merge 前一併更新但不阻擋 ready）

## 6. Suggested Owner for Fixes
- 🟡 #1, #2 → 提交者本人（qazabc159-blip / 派工紀錄上是 Jim）更新 PR title/body；也可由 Elva 直接在 merge 前手動編輯 PR body 代勞（純文字，非 code）

## 7. Re-review Required
NO（🟡 為描述性文字修正，不影響行為正確性，不需重審 code）

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6 Day (auth pages cluster, B 類快審)
