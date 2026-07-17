# PR #1301 Desk Review — Pete 2026-07-18

## 1. PR Intent
- shell-wide 修復（B 類快審）：①TickerTape fetch 失敗先安靜重試一次(1.5s)才宣告誠實空態＋措辭改「尚無盤面資料」②`/settings/*` 三頁加入 ticker skip 清單③Sidebar 底部「資料健康/風控狀態」從全站恆綠靜態文字改真推導 live/close/delayed/empty 四態（重用既有 `market-data/overview` 端點，零新後端）④header-dock 隱藏規則從只鎖 `/portfolio` 擴大到不分 data-final-screen 值，含 `/market-intel`、`/desk-exact`。
- 對應 sprint task：Elva 7/17 全產品走查 P1-a/P1-b。
- Base branch：main（正確，非 stacked chain）。

## 2. Diff Summary
- 改 7 個檔（含 2 測試檔）：`apps/web/app/globals.css`、`apps/web/components/FinalOnlyFrame.tsx`、`apps/web/components/Sidebar.tsx`、`apps/web/components/TickerTape.tsx`、`apps/web/lib/ticker-tape.ts`、`apps/web/lib/final-v031-paper-ticket.test.ts`、`apps/web/lib/ticker-tape.test.ts`
- LOC: +97 / -9
- 全部落在 apps/web shell 範圍；未碰 apps/api、公司頁、auth（與 #1300 Jason 無檔案交集）

## 3. IUF Blocker Checklist
- §A Kill-switch/Real-order：PASS — 全 diff 無 KILL_SWITCH/EXECUTION_MODE/place_order/submit_order 字樣；Sidebar.tsx:97「Real Order 鎖定．僅 Paper/SIM」是純顯示字串，非開關；對照 CLAUDE.md 真金下單路徑硬擋現況＝已驗證為真的靜態事實，非新一輪假顯示。
- §B Auth/Secret：PASS — 未新增 endpoint；沿用既有 `getMarketDataOverview()`（`credentials:"include"`），無 hardcode secret，無 person_id/session 洩漏。
- §C State/Schema：N/A — 無 migration、無 enum/state machine 變更；元件 state 為 React useState，重啟本就會重置，非設計成持久化。
- §D PR Hygiene：PASS — title `fix(web): ...(P1-a/P1-b)` 符 conventional commits；DRAFT 起手；base=main 正確；PR body 含測試結果與已知 gap（FinMind env 殘留、無 auto-merge）。
- §E 不可越線：PASS — 未越 lane（純 apps/web shell）；無 governance bypass；無 KGI gateway `/order/create`；無 redaction 違規。

## 4. Findings — Priority Ranked

### 🔴 Blockers
無。

### 🟡 Suggestions
1. **Sidebar 新增的 `market-data/overview` 呼叫無 client-side timeout/AbortController**
   - 位置：`apps/web/components/Sidebar.tsx:105-118`（`useEffect` 內 `getMarketDataOverview({...}).then().catch()`）
   - 原因：TickerTape 那支呼叫至少有 1.5s 重試上界＋`request()` 沒有全域 timeout；今晚 #1292/#1294 才根治過這支端點被 `isTwTradingDay()` memoized promise 卡死 14hr 的案例（#1294 79b86d06 已修根因），此次未再引入新 hang 風險，但若日後同類 regression 再現，這顆 widget 會永遠停在「查詢中」——不是假綠但也不是誠實的失敗態，只是卡住。建議比照 TickerTape 加同等 timeout guard，或共用同一個 hook 減少重複呼叫（見下一條）。
   - Failure scenario：後端該端點再度掛死 → Sidebar widget 永遠顯示「查詢中」，不會像本 PR 主張的那樣落到 `empty` 誠實態。
2. **TickerTape 與 Sidebar 各自獨立呼叫同一顆 `GET /api/v1/market-data/overview`**（差異只在 `topLimit: 15` vs `1`）
   - 位置：`apps/web/components/TickerTape.tsx:59` 與 `apps/web/components/Sidebar.tsx:107`
   - 確認：Sidebar 的 `useEffect` deps 是 `[]`，而 Sidebar/TickerTape 都掛在 root layout（`apps/web/app/layout.tsx:62-65`）不會隨 client-side route change 重新掛載，所以這是「每個瀏覽器 session 多一次呼叫」而非使用者原本擔心的「每頁多一次」——影響比預期小，非阻塞項，但仍是同端點兩份獨立 fetch，可考慮日後合併成一個共用 hook/context 供兩元件消費同一份 response，省一次 round-trip。
3. **header-dock 隱藏後，`/market-intel`、`/desk-exact` 失去 `設定/通知/AI每日簡報` 的唯一導覽入口**
   - 位置：`apps/web/components/header-dock.tsx:483-532,617-639`（Settings 抽屜含 `/settings/account`、`/settings/broker`、`/settings/subscription`；另有 `/briefs`、`/alerts`、`/ops`）；這些路徑不在 Sidebar 的三個導覽陣列（`CANONICAL_PRODUCT_SURFACES`/`OWNER_PRODUCT_SURFACES`/`INTERNAL_ADMIN_SURFACES`）內，只活在 `SUPPORT_WEB_SURFACES`（`canonical-surfaces.ts:256+`），唯一入口就是 header-dock。
   - 確認為非阻塞：Sidebar 自己的「登出」按鈕（`Sidebar.tsx` 底部 `tac-sidebar-logout`）獨立於 header-dock，不受影響，仍可隨時登出；且此隱藏規則本就是延續 `/portfolio` 既有已上線行為（非本 PR 新創決策），使用者可先點 Sidebar 任一導覽項離開 market-intel/desk-exact，到別頁再用 header-dock 進設定/通知，非死路。
   - 建議：既然 3 個高流量頁（portfolio + market-intel + desk-exact）現在都恆隱藏 header-dock，值得請 Elva/Jim 評估是否要在 Sidebar 補一個輕量「設定」導覽項，避免往後每加一個 FinalOnlyFrame 變體都預設吃掉通知/設定入口。

### 💭 Nits
1. `final-v031-paper-ticket.test.ts` 與 `ticker-tape.test.ts` 的新增斷言沿用既有的「grep 原始碼字串」測試風格（`frameSource.toContain(...)`），非行為測試；非本 PR 引入的新模式（檔案本來就這樣寫），僅提醒日後若 CSS selector 再變動，這類字串斷言容易變成脆弱測試。

### ✅ Praise
- 根因說明誠實且比走查描述更嚴重也如實講出來（Sidebar widget 從未接過任何資料源，而非「漏出錯誤」）——符合本 repo「不假綠」鐵律的精神，是這次審查中最值得肯定的一點。
- TickerTape 重試邏輯（isRetry 旗標＋單次 1.5s 上界＋`cancelled`/`timer` 清理）設計乾淨，追蹤過所有分支都不會產生重複計時器或無限重試。
- 改動精準收斂在 apps/web shell，未见 scope creep，也未動到 command-palette/source-badge 既有的 `paper-trading-room` 限定選擇器（只放寬 header-dock 一項），符合 Surgical Changes 精神。

## 5. Verdict
- [x] APPROVED — 可 ready，0 blocker，3 suggestion（皆非阻塞，建議收斂到後續 ticket）

## 6. Suggested Owner for Fixes
- 🟡 #1（Sidebar timeout guard） → Jim
- 🟡 #2（合併重複呼叫） → Jim
- 🟡 #3（設定/通知導覽入口評估） → Elva（產品決策）+ Jim（實作）

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-18
Sprint: W6 Day (shell 走查 P1-a/P1-b, B 類快審)
