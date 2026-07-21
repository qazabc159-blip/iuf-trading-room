# PR #1335 Desk Review — Pete 2026-07-21

## 1. PR Intent
- 首頁 hero band 拆兩個獨立 `<Suspense>` 邊界：大盤指數（`IdxAnchorSection`，快，只等 overview group：kgi-overview/twse-overview/twse-heatmap）與熱力圖磚格（`HeatZoneSection`，慢，另等 kgi-core-heatmap group），讓指數不再被最慢的來源拖住。
- 對應 sprint task：2026-07-21 楊董急件，首頁效能（承接 #1312/#1334 同類 Suspense 拆流手法）。
- Base branch：`main`（正確）。

## 2. Diff Summary
- 改了 1 個檔：`apps/web/app/page.tsx`
- 主要改動：`loadRealtimeMarketDashboard` 拆成 `loadMarketOverviewFeed`（overview 3 支）＋`loadMarketHeatmapFeed`（heatmap 1 支）各自 `cache()`；新增 `mergeRealtimeMarketFeeds()` 給 `HeatZoneSection` 合併回單一形狀；`HeroBandSection` 拆成 `IdxAnchorSection`／`HeatZoneSection`／`IndexHistorySection` 三個各自 Suspense；`.heroband` 容器改靜態同步輸出；新增 `pendingMarketOverviewPlaceholder()` 餵給 fast path 的 `market` 參數。
- LOC: +148 / -53

## 3. IUF Blocker Checklist
- A（Kill-switch/下單）：N/A，純前端 page.tsx，無下單路徑觸碰。PASS
- B（Auth/Secret）：無新 endpoint、無 secret、無 session 邏輯改動。PASS
- C（State/Schema）：無 DB/migration/enum 改動。N/A
- D（PR Hygiene）：title/branch/commit message 符合慣例（`perf/` 前綴延續 #1312/#1334 既有慣例）；PR description 誠實列出「過程中抓到並修掉的一個真回歸」（第一版漏放 twse-heatmap 進 overview group 致漲跌家數 0/0/0）；test plan 最後一項誠實留白待 Elva/Pete 盤後親驗，非灌水全勾。PASS
- E（IUF 不可越線）：無 lane 越界、無 governance bypass、無 KGI `/order/create` 呼叫、無 redaction 違規。PASS

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
1. **指數 fast path 靜默丟失既有「跨源日期整合校驗」與「第三層優雅降級」，PR 自稱「非新語意」不準確**
   - 位置：`apps/web/app/page.tsx` `IdxAnchorSection`（呼叫 `readMarketIndex(overviewFeed, pendingMarketOverviewPlaceholder(), ...)` / `readMarketBreadth(overviewFeed, pendingMarketOverviewPlaceholder(), [])`）vs `readMarketIndex`/`readMarketBreadth` 函式本體（未動，`origin/main` 同檔 818/877 行）
   - 原因：`readMarketIndex` tier-2（twse 分支）內建 `resolveAuthoritativeTradeDate([...twse_overview, market_context_index])` 交叉校驗——這正是 7/17 楊董升級的 market-data-integrity-gate（#1297，修過「banner 07/16 vs 磚 07/17」不一致）機制本體，目的是避免同一頁不同區塊各自秀出不同交易日期。tier-3（`market.marketContext.index` 純 fallback，"昨日收盤"）也是同一函式既有的優雅降級。本 PR 讓 `IdxAnchorSection` 永遠傳入 `pendingMarketOverviewPlaceholder()`（`data:null` 的假 BLOCKED 佔位），使這兩層在**這條路徑上結構性永遠不可達**——不是「這些來源真逾時走的相同分支」，而是「原本可能被真實 market 資料改寫/救援的分支被永久堵死」，跟同頁 `MastDynamic`（仍等真 `cachedMarket()`，見 mast_slot 市場文案）、`HeatZoneSection`（仍等真 `cachedMarket()`）用的是**不同輸入**算同一份 `readMarketIndex`。
   - 影響範圍：kgi_overview 缺值時（EC2 gateway 平日 14:10 關閉後到隔日 08:20＋整個週末，本來就是常態非邊界案例）才會落到 tier-2/tier-3，並非罕見窗口；意味著多數非盤中頁面瀏覽時段，hero 巨大指數數字的日期/取值邏輯已經跟 mast 小字區塊、熱力圖來源標籤走上不同的協調路徑，重新打開 #1297 想根治的「同頁不同區塊日期互相打架」這一類回歸的窗口（即使今天 screenshot 比對零差異，很可能是比對時機落在 kgi tier-1 有值的時段，沒覆蓋到 kgi 缺值的 tier-2/3 分支）。
   - 建議：`IdxAnchorSection` 改成也等真的 `cachedMarket()`（若怕拖慢，可只抽 `market.marketContext.index` 這個輕量欄位單獨快取/快速讀取，不必等整個 `getMarketDataOverview()` 的其餘慢欄位），或至少在 merge 前用「kgi_overview 故意回空」的情境做一次盤後/離峰截圖比對 mast vs hero index 日期是否一致，把驗證證據補進 PR。

### 🟡 Suggestions (should fix)
1. **漲跌家數 tier-3/tier-4 fallback 在 fast path 上同樣結構性不可達**：`readMarketBreadth` 的 `legacyBreadth`（`market.marketContext.breadth`）與最後一層「用 heatmap 陣列自算」都吃同一組 `pendingMarketOverviewPlaceholder()`/`heatmap=[]` 輸入，永遠不可達。目前 tier-1（kgi breadth）／tier-2（`buildTwseIndustryRows`，這輪已修正真的吃到 twse-heatmap）在 KGI 與 TWSE 任一還活著時都夠用，只有「KGI 與 TWSE-derived 來源同時掛」這種雙重斷源才會退回本 PR 自己說要避免的「0 漲 0 平 0 跌」——機率比第一版的觸發條件低很多，但不是零，建議至少留 tracking note。
2. **回歸驗證缺自動化測試覆蓋**：`readMarketIndex`/`IdxAnchorPanel` 目前不是可直接單元測試的 exported 純函式（在 `page.tsx` 內部），本 PR 用的驗證手段是本機截圖比對＋既有 `jim_home_heatmap_mode_toggle_20260717.spec.ts`，兩者都沒有專門覆蓋「kgi_overview 缺值、twse_overview 有值」這個關鍵分支——這正是 🔴 #1 唯一會實際現形的情境，建議至少手動用假資料跑一次這個分支的截圖對照。

### 💭 Nits (nice to have)
1. `IndexHistorySkeleton` 比舊版 `HeroBandSkeleton` 少了 `marginTop: 1`（1px），loading 態極短暫瞬間差異，肉眼幾乎無感，但既然楊董對首頁像素級挑剔，補上更保險。

### ✅ Praise
- **架構收斂乾淨**：`.heroband` 容器從「整個 async 產物」改成靜態同步殼＋兩個各自獨立 `cache()` 的子 Suspense，是本輪（延續 #1312/#1334）Suspense 拆流手法裡最俐落的一版；`mergeRealtimeMarketFeeds()` 把兩個獨立 `LoadState` 合併回 `HeatZonePanel` 原本期待的單一形狀，設計乾淨不用改任何下游元件簽章。
- **作者自己抓到並修掉真回歸**：PR description 誠實記錄「第一版拆法漏放 twse-heatmap 進 overview group，本機截圖比對 prod 抓到漲跌家數退化成 0/0/0」，而且真的用截圖比對抓到、不是憑空聲稱——這是 desk review 最想看到的自我查核紀律。
- **行動版 order 值有想清楚**：新 skeleton 的 `order:1`/`order:4` inline style 對齊 globals.css 手機斷點既有 `.idxanchor{order:1}`/`.heatzone{order:4}`，避免 loading 態跟最終內容順序不一致造成跳動，細節有顧到。

## 5. Verdict
- [ ] APPROVED
- [x] NEEDS_FIX — 1 個 🔴（指數/漲跌家數 fast path 靜默丟失既有跨源校驗與優雅降級層，非「無新語意」），2 個 🟡
- [ ] BLOCKED

## 6. Suggested Owner for Fixes
- 🔴 #1 → Jim（補回真 `cachedMarket()` 輸入或至少離峰情境驗證證據）
- 🟡 #1 → Jim（留 tracking note 即可，非阻擋項）
- 🟡 #2 → Jim（補離峰分支截圖或抽出純函式加測試）

## 7. Re-review Required
YES（🔴 修完或補齊驗證證據後需 Pete 重審）

---
Reviewer: Pete
Date: 2026-07-21
Sprint: W6 Day (2026-07-21 盤後急件)
