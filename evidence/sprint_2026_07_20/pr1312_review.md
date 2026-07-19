# PR #1312 Desk Review — Pete 2026-07-20

## 1. PR Intent
- 公司頁首屏 ~10s 骨架感（Elva 走查判定）根因＝`getCompanyKBar`（freq 預設 1m，後端序列 for 迴圈打 FinMind，冷啟動 7.5-8s）被塞進阻塞的 `Promise.allSettled`，拖垮 hero/日線這些真正首屏必要資料。
- 修法：kbar fetch 移出阻塞路徑，改成先發起不 await 的共用 `kbarPromise`；4 個消費點（K線圖容器/逐筆成交面板/資料來源狀態卡/HUD 分K狀態格）各包一個 async Server Component + `<Suspense>`，共用同一 promise，不重複打 API。
- 對應 sprint task：Elva 7/19 夜間走查抓到的效能症狀，非 sprint 編號制任務。
- Base branch：`main`（merge-base == origin/main tip `24d5cc21`，乾淨單 commit）。

## 2. Diff Summary
- 改了 1 個 production 檔 + 1 份 RCA 報告 + 2 張截圖
- 主要改動：`apps/web/app/companies/[symbol]/page.tsx` — 新增 `resolveKbar()` 共用 resolver + 4 個 async Suspense Section 元件；kbar 從阻塞 `Promise.allSettled` 抽離成獨立 `kbarPromise`
- LOC: +278 / -47（page.tsx 本身 +204/-47 概估；其餘為 RCA md + 二進位截圖）
- 未觸碰 `OhlcvCandlestickChart.tsx` / `TickStreamPanel.tsx` / `SourceStatusCard.tsx`（grep 確認零改動，親自 diff 該三檔 vs origin/main 一致）

## 3. IUF Blocker Checklist
- A 真金/kill-switch：PASS（diff 全文 grep `kill_switch|execution_mode|place_order|submit_order|kgi.order.create` 零命中；純前端資料抓取時序改動）
- B Auth/Secret：N/A（無新 endpoint、無 secret 字面）
- C State/Schema：N/A（無 DB migration、無 enum 擴充）
- D PR Hygiene：PASS（branch `perf/company-first-paint-jason-20260720`、commit `perf(web): ...` 符合 conventional commits、base=main 乾淨、DRAFT 狀態、description 附 RCA 數據表，逐項與 diff 核對一致，零落差）
- E 不可越線：PASS，唯一觀察點——Jason（lane_boundaries.md 定義為 backend-strategy only）改了 `apps/web/app` 下的檔案；已核實改動範圍純屬 Server Component 資料抓取編排（何時/如何呼叫既有 API），零觸碰任何 UI/樣式/元件檔案本身，屬性質上更接近「後端資料流時序」而非前端視覺，判斷可接受但列 🟡 供 Elva 知悉（非阻擋）。

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
無。

### 🟡 Suggestions (should fix)
1. **kbar fetch 無 timeout／AbortSignal，真掛死（非只是慢）時 4 個 widget 會永遠停在「載入中」/EMPTY，不會轉成誠實的 BLOCKED**
   - 位置：`apps/web/lib/api.ts:104-140`（`request()`，`getCompanyKBar` 呼叫的 `fetch()` 無 `AbortSignal.timeout`）；本 PR 未新增此問題，只是把原本會拖死整頁的風險縮小成 4 個局部 widget
   - 原因：這是把「整頁掛死」降級成「4 個 widget 永遠 loading」的淨改善，非新引入的回歸——但仍是尚未真正 bound 的外部呼叫，符合本 repo「掛死三連問」查核類別中「有無 AbortSignal.timeout」一項未過
   - 建議：後續票給 `getCompanyKBar` 的 request 包一個合理逾時（如 10-12s），逾時後 `resolveKbar` 的 catch 分支即可誠實顯示「暫停」而非無限期「載入中」；不阻擋本票 ready

2. **`jim_company_page_fix_20260712.spec.ts` 硬編碼法人買賣超數值斷言（`/1\.2\d萬張/`）預期會隨行情自然飄移失敗，PR description 聲稱「對照未改版 prod 同樣失敗」**
   - 位置：`packages/qa-playwright/tests/jim_company_page_fix_20260712.spec.ts:58-71`
   - 原因：該斷言比對 2026-07-12 репро當下的真實法人買賣超快照值，與本次 kbar/Suspense 時序改動無關聯（純數字格式驗證，非時序驗證）；讀碼可證實此斷言性質上必然隨市場資料日日飄移，宣稱可信，但「對照 prod 同樣失敗」一句我未親自重跑驗證（非 Pete 職權，屬 Bruce 驗證範疇）
   - 建議：Bruce merge 前用一次 CI run 確認 13/14 而非其他數字掉隊；PR 已誠實揭露非本票範圍，可視為已知欠帳

3. **Suspense fallback 對 `OhlcvCandlestickChart` 直接沿用同元件缺省值（`kbarState="EMPTY"`）**，語意上跟「這檔真的沒有分K資料」無法從畫面上分辨（僅差在後續是否會被替換）
   - 位置：`apps/web/app/companies/[symbol]/page.tsx` KBarChartSection 的 Suspense fallback 區塊
   - 原因：過渡態與真空態文案相同是刻意設計（複用既有元件、零新增假骨架），且會在 resolve 後無縫替換為真值，失敗方向是「多顯示一下無資料」而非「假裝有資料」，符合本 repo 一貫「不假綠」方向；僅 HUD 分K狀態小格有獨立「載入中」文案做出區分
   - 建議：可選——若要更誠實，可比照 HUD 格作法在其餘 3 處 fallback 也加一個視覺上輕量的「載入中」指示（如既有 badge 顏色態），非必要

### 💭 Nits (nice to have)
1. `KBarSourceStatusSection` 的 fallback（`SourceStatusCard`）與函式本體各自各寫一次 `buildSourceStatus(...)` 呼叫（reasonable duplication，僅 state 常數不同），可考慮抽成共用 helper 減少兩處手動同步風險，但目前兩處手打的值一致，非急迫。

### ✅ Praise
- RCA 方法紮實：不是憑瀏覽器 waterfall 猜測，而是 owner session 直接 curl 打 prod 逐支量測 `time_total` 冷/暖對照，精準揪出唯一離群值（kbar 7.5-8s vs 其餘 0.4-1.5s），比對本 repo一貫「宣稱前先查證」鐵律做得到位。
- RSC promise 傳遞模式正確：`kbarPromise` 全程只在 Server Component 之間傳遞（page.tsx → 4 個 async Section 元件），從未被傳進任何 `"use client"` 元件（`OhlcvCandlestickChart`/`TickStreamPanel`/`SourceStatusCard` 皆為 client component，但它們收到的都是已 resolve 的 plain props，非 promise 本身），避開了「RSC 下 promise 需 `use()` hook」的誤用陷阱。
- 4 個 kbar 消費點全部排查到位（K線圖/逐筆成交/資料來源狀態卡/HUD 分K狀態格），透過檔案自帶 grep 排查手法一次到位，零漏改導致的編譯錯或 stale 變數引用（親自 grep `kbarView|kbarState|kbarReason` 確認乾淨）。
- 零觸碰任何被消費的 UI 元件檔案本身，改動面精準侷限在資料抓取編排層，完全符合「已打磨元件只准複用不准重寫」鐵律。
- 誠實揭露已知測試資料飄移（法人數值斷言）而非隱藏或硬改測試遷就通過。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（3 🟡 + 1 💭 皆為建議/待 Bruce 複驗項，非結構性問題）

## 6. Suggested Owner for Fixes
- 🟡 #1（kbar timeout）→ Jason（下一輪效能/穩健性票）
- 🟡 #2（法人硬編碼斷言飄移）→ Bruce（merge 前 CI 複驗）／後續由測試維護 owner 排除硬編碼真實數值
- 🟡 #3（fallback 誠實性微調）→ Jason（可選）
- 💭 #1 → Jason（可選）

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-20
Sprint: W6+ 效能修復（company-first-paint）
