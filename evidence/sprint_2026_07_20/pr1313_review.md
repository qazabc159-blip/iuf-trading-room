# PR #1313 Desk Review — Pete 2026-07-20

## 1. PR Intent
- `/m`（手機報價卡）：KGI ticks 拿不到值（收盤/離峰/斷線）時，補打 `GET /api/v1/market-data/effective-quotes`（`includeStale:true`），把 `closed_snapshot`/`official_close`+stale 兜底價顯示成誠實「MM/DD 收盤」，取代舊版「排程關機中」+裸 `--`。順手修 `lib/api.ts` client-side same-origin proxy allowlist 漏了 `effective-quotes`（server 側 `route.ts` 早就白名單過，client 端沒對齊，CI PR-preview 的跨源拓樸下會直接失敗）。
- `/track-record`：整頁 owner-only gate（Elva 7/20 治理急救——Athena 7/18 §2「F-AUTO 運行績效不得對非 owner 使用者揭露」，本頁 B 區塊正好渲染這個）。Gate 在 Server Component 內、任何資料 fetch 之前完成（`getCurrentUserSession()`），非 owner 顯示「此頁尚未開放」。
- 對應 sprint task：W6 paper sprint 治理修復鏈（延續 #1304/#1307/#1309/#1310 effective-quotes 誠實性系列 + 7/18 Athena §2 治理事件）。
- Base branch：`main`（merge-base = origin/main tip `24d5cc21`，PR 分支未落後，diff 乾淨）。

## 2. Diff Summary
- 改了 8 個檔（`git diff --stat origin/main...origin/fix/mobile-quotes-trackrecord-gate-jim7-20260720`）
- 主要改動：
  - `apps/web/app/m/MobileKgiWatchlist.tsx`：5-state（新增 `closed`，移除 `scheduled-off`）+ 批次 fallback 呼叫
  - `apps/web/app/m/mobile-quote-effective-fallback.ts`（新檔）：純函式 `deriveEffectiveFallbackCellState()`
  - `apps/web/app/m/mobile-quote-effective-fallback.test.ts`（新檔）：5 個 unit test
  - `apps/web/app/track-record/page.tsx`：gate-before-fetch 佈線
  - `apps/web/app/track-record/track-record-owner-gate.ts`（新檔）+ test：純函式 `isTrackRecordOwnerSession()`
  - `apps/web/lib/api.ts`：`SAME_ORIGIN_GET_PROXY_PATHS` +1 行、新增 `getCurrentUserSession()`
  - `apps/web/app/ops/f-auto/FAutoNavPanel.tsx`：4 行文案 drive-by（`/track-record` 共用同一元件，過期措辭修正）
- LOC: +361 / -24
- CI：5/5 綠（validate / W6 audit / Secret Regression / DB-mode / Playwright P0 Smoke），DRAFT 狀態。

## 3. IUF Blocker Checklist

**A. Kill-switch / Real-order Safety**
- grep 全 diff `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|kgi.order.create|order/create` → 0 命中。PASS
- 無下單路徑觸碰，純報價顯示 + 頁面 gate。N/A

**B. Auth / Secret Hygiene**
- grep 全 diff `api_key|secret|password|token` → 0 命中。PASS
- 新 `getCurrentUserSession()` 用 `requestRaw()`（既有 `next/headers` cookie 轉發機制，未新增獨立鏈路）。PASS
- 🔴 見 Finding #2：`/track-record` 頁面 gate 正確 fail-closed，但其下游兩支 API（`/api/v1/track-record/nav`、`/performance`）本身仍是「login-only 無 role check」（既有 #1177 設計），繞過頁面直打 API 可拿到本票宣稱要擋住的資料。

**C. State / Schema Integrity**
- 無 migration、無 enum 變更、無 runtime state。N/A

**D. PR Hygiene**
- 分支名 `fix/mobile-quotes-trackrecord-gate-jim7-20260720` 符合 `<type>/<主題>-<作者>-<YYYYMMDD>`。PASS
- Commit message conventional（`fix(web): ...`）。PASS
- Base branch = main，非疊層鏈的一環，乾淨。PASS
- PR description 列出 test plan + 已知缺口（誠實標記 Playwright P0 待跑）。PASS

**E. IUF 不可越線**
- 0 governance bypass；DRAFT 狀態未 merge。PASS
- 0 KGI gateway `/order/create` 呼叫。PASS
- Redaction：無 person_id/token 明碼外流。PASS

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)

1. **[資料誠實 / 假綠]** `/m` watchlist 的 fallback 純函式把「非 official_close 來源的 stale 報價」誤標成 `"live"`，違反本 repo 剛在 #1310 才立下、且此 PR 自稱要鏡射的 fresh/stale 顯示區分慣例。
   - 位置：`apps/web/app/m/mobile-quote-effective-fallback.ts` 最終 `return` 分支（第 44 行附近）：`if (item.freshnessStatus === "closed_snapshot") {...} if (item.selectedSource === "official_close" && item.freshnessStatus === "stale") {...} return { status: "live", ... }` — 這個 fallback 分支對「`freshnessStatus === "stale"` 但 `selectedSource` 不是 `official_close`」（例如 `twse_mis`/`kgi`/`manual` 本身過舊）完全沒攔，直接歸類成 `"live"`。
   - Failure scenario：盤中 KGI ticks 因訂閱/連線問題回空（`missing` list 非空，這正是 fallback 被呼叫的觸發條件）→ 批次打 `getEffectiveQuotes({includeStale:true})` → `resolveMarketQuotes()` 的 `eligible = quote !== null && (includeStale || fresh)`（`apps/api/src/market-data.ts` `resolveMarketQuotes`）在 `includeStale:true` 下對任何有快取值的來源都判 eligible，即使該來源的快取已經很舊（`freshnessStatus:"stale"`）→ selected 一支 `twse_mis` 舊報價 → `deriveEffectiveFallbackCellState` 落入最後分支回傳 `{status:"live",...}` → `MobileKgiWatchlist` 把它算進 `liveCount`，畫出綠色脈動點 + 「即時報價」文案 + 正常漲跌色調 —— 使用者在手機上看到一個過時報價卻被告知「即時」。這正是同一份 diff docstring 自稱鏡射的 `apps/web/public/desk-exact/index.html` `effectiveQuoteStateLabel()` 明確會避免的情境（該函式對所有非 `closed_snapshot` 來源都用 `freshnessStatus === "fresh" ? "即時" : "（略舊）"` 區分），也是 `/quote` 頁 `freshnessLabel()` 的既有慣例（`fresh`→「即時」／`stale`→「略舊」）。
   - 建議：`deriveEffectiveFallbackCellState` 在最終分支前加一個判斷：`freshnessStatus !== "fresh"` 時一律走「closed/stale」顯示分支（沿用「MM/DD 收盤」或至少「略舊」標示），不要讓非 fresh 的資料落進 `"live"`。目前 5 個 unit test 都沒覆蓋這個 case（`selectedSource:"twse_mis", freshnessStatus:"stale"`），建議一併補測試鎖回歸。

2. **[治理閉環不完整]** `/track-record` 的整頁 owner gate 只擋住了「頁面渲染」，但頁面實際呼叫的兩支 API（`GET /api/v1/track-record/nav`、`GET /api/v1/track-record/performance`）本身完全沒有 Owner role check——任何已登入非 owner 角色繞過頁面、直接打這兩支端點，依然能拿到 F-AUTO NAV / AI 推薦績效資料，跟本 PR 引用的 Athena §2（F-AUTO 運行績效不得對非 owner 揭露）目標不符。
   - 位置：`apps/api/src/server.ts:5619`（`app.get("/api/v1/track-record/nav", ...)`）、`apps/api/src/server.ts:21839`（`app.get("/api/v1/track-record/performance", ...)`）——兩支路由內都沒有 `c.get("session")` role 檢查，註解明寫「Gate = login-only (no role check beyond the global session middleware)」，這是 #1177（7/5）就定的既有設計，本票沒動它。
   - Failure scenario：一個 Trader/Analyst/Viewer 角色的已登入使用者（未來多租戶客戶）打開瀏覽器 devtools 或直接 `curl -H "Cookie: ..." https://api.eycvector.com/api/v1/track-record/nav`，會得到 200 + 完整 `navCurve`/`weeks`/`summary`（F-AUTO 帳本數字）——跟他打開 `/track-record` 頁面看到「此頁尚未開放」的體驗完全矛盾，且正是 §2 要防的資料外流路徑，只是換了個管道（API 直打而非頁面渲染）。
   - 本票 page.tsx docstring 有誠實揭露這是「第一步保守處置...內容整改留待另案」，但既然本票的 PR 標題與 summary 明確以「Athena §2 governance fix」為理由，這個殘留缺口值得攤在檯面上讓 Elva 明確拍板（是否接受「先擋頁面、API 另案」的階段性風險，或直接把兩支路由補上跟既有 Owner-only 版本一致的 role check——改動量很小，`session.user.role !== "Owner"` 兩行 × 2）。

### 🟡 Suggestions (should fix)

1. `getCurrentUserSession()`（`apps/web/lib/api.ts`，經 `requestRaw()`）跟這個檔案裡所有既有 SSR fetch 一樣沒有 `AbortSignal.timeout`——不是本票新增的風險（既有系統性模式），但 `/track-record` 的 gate 現在是「任何渲染前必先等這支 fetch resolve」的關卡，如果這支請求真的掛住不 resolve（非 reject），整頁會無限卡住而非顯示誠實的 BLOCKED 狀態。建議跟其他 SSR fetch 一起排進「補 timeout」的系統性 follow-up，不必本票解決。
2. `isTrackRecordOwnerSession()`（`track-record-owner-gate.ts`）用字面 `session.role === "Owner"` 比對，`packages/contracts/src/entitlements.ts` 已有現成 `isOwnerRole(role)` helper 供其他頁面共用（`f-auto/page.tsx` 目前也是自己字面比對，非此票獨有）——建議之後統一收斂成一個共用 helper，避免未來角色字串改名時要記得同步多處。
3. 沒有 Playwright/e2e 層級測試覆蓋「已登入但非 owner」造訪 `/track-record` 的實際渲染結果（既有 `track-record.spec.ts` 只測 Owner session 和未登入兩種情境，新行為靠 SSR 特性只能用 vitest 純函式測試佐證邏輯，佈線正確性完全仰賴人工 code review——本輪已手動核對過 `page.tsx` 第 178-185 行確認 gate 真的在 `getTrackRecordPerformance()`/`<FAutoNavSection>` 之前 return，判斷正確）。建議後續補一支用假 session cookie（Analyst/Trader 角色）驗證頁面文字含「此頁尚未開放」且不含「樣本 N 筆推薦」/NAV 數字的 e2e，鎖住這個新分支不被未來重構破壞。
4. `fetchEffectiveQuoteFallback()`（`MobileKgiWatchlist.tsx`）跟同檔案既有 `fetchQuoteForSymbol()` 一樣沒有請求逾時；由於輪詢用 `setInterval`（非遞迴 `setTimeout`），若單次 fallback 呼叫真的掛住，下一輪 15s 排程仍會疊加發出新請求（既有模式，非本票引入的新風險，僅提醒新呼叫點也繼承了這個系統性特徵）。

### 💭 Nits (nice to have)

1. `mobile-quote-effective-fallback.ts` 的 docstring 把根因/歷史脈絡（#1307/#1309/#1310/Pete review）都交代得很清楚，對未來維護者友善，值得保留這個寫法慣例。
2. `FAutoNavPanel.tsx` 的 4 行文案 drive-by 技術上超出 PR 標題宣告的兩個範圍（`/m` + `/track-record`），但因為是同一個共用元件被 `/track-record` 直接消費、且改動極小風險低，不視為越界。

### ✅ Praise
- `/track-record` 的 SSR gate 佈線是這輪最紮實的部分：作者自己的 per-agent memory（`feedback_ssr_owner_gate_must_precede_fetch_not_client_side_2026_07_20.md`）precisely 抓到「client-side gate 包一層」在 Server Component 情境下會把資料序列化進 RSC payload、看似安全實則已外洩的陷阱，並正確改成 gate-before-fetch（`page.tsx:178-185` 已人工核對，`getCurrentUserSession()` 確實在 `getTrackRecordPerformance()` 與 `<FAutoNavSection>`（內部才會呼叫 `getTrackRecordNav()`）之前 return）。這是一個容易犯錯、这次没犯錯的正確判斷。
- allowlist 修復（`SAME_ORIGIN_GET_PROXY_PATHS` 補一行）範圍精準：只加了跟 server 端 `route.ts` `GET_ALLOWLIST` 已存在的同一個 pattern 對齊，沒有夾帶任何其他端點，親自 grep 過 `route.ts` 確認 `effective-quotes` 早已在白名單、本票沒有動到 server 端。
- unit test 覆蓋率意識好：兩個新純函式都各自搭配了獨立 test 檔，`mobile-quote-effective-fallback.test.ts` 甚至專門寫了一個「Pete #1310 regression guard」案例防止 official_close+stale 被誤標成 live——只是這次沒把同一個警覺延伸到「非 official_close 的 stale」這個相鄰案例（見 Blocker #1）。

## 5. Verdict
- [x] NEEDS_FIX — 2 個 🔴 blocker，owner 修完重 review

## 6. Suggested Owner for Fixes
- 🔴 #1（stale 誤標 live）→ Jim（本票作者，純前端純函式修正 + 補測試）
- 🔴 #2（track-record API 缺 role check）→ Jason（後端補 2 支路由的 role check）或 Elva 明確拍板接受階段性風險並記錄
- 🟡 #1-4 → Jim（timeout / helper 收斂 / e2e 補測可排 follow-up，非本票必修）

## 7. Re-review Required
YES

---
Reviewer: Pete
Date: 2026-07-20
Sprint: W6 Day 7（paper sprint 治理修復鏈延續）
