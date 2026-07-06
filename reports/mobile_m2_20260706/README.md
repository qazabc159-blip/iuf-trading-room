# Mobile M2 — 共用元件觸控債 + 公司頁手機化（390px）

派工：行動體驗 M2。清 M1 留下的共用元件觸控債（header dock / Cmd-K 搜尋），並把
`/companies/[symbol]` 這個最高價值頁之一在 390px 下修到可用。
**行為零變更，純呈現層（CSS + 3 個 className 掛點）。**

量測方法同 M1：本機 dev server（`NEXT_PUBLIC_API_BASE_URL` 指向 prod API +
真實 owner session cookie，取真資料而非空殼 BLOCKED 狀態）、iPhone 13 viewport
(390×844)、Playwright 量頁面級水平溢出（`document.documentElement.scrollWidth`
vs `clientWidth`）與逐元素 <14px 字級 / <44px 觸控目標清單。

## 證據檔案

| 檔案 | 說明 |
|---|---|
| `before_companies_2330_390.png` / `after_companies_2330_390.png` | 公司頁 (2330) 390×844 全頁截圖 |
| `before_finance_table_detail.png` / `after_finance_table_detail.png` | 財報表格卡片化 before/after 特寫 |
| `before_finance_tabs_detail.png` / `after_finance_tabs_detail.png` | 財報/月營收 tab 觸控高度 before/after 特寫 |
| `after_indicator_toggle_bar_detail.png` | K 線指標 chip 觸控高度 after 特寫 |
| `after_home_topbar_search_detail.png` | 首頁「搜尋 ⌘K」按鈕 after 特寫 |
| `after_header_dock_detail.png` | header dock 4 顆圖示按鈕 after 特寫 |
| `before_a11y_overflow_audit.json` / `after_a11y_overflow_audit.json` | 公司頁逐元素量測：頁面級水平溢出、<44px 觸控目標清單 |

## Before 現況（390px 實測，公司頁 2330）

- 頁面本體沒有水平溢出（`docScrollWidth` = `docClientWidth` = 390）— 既有的
  1180px/768px/480px 斷點已把佈局收成單欄。
- **真 bug（非單純觸控偏小）**：`FinancialsPanel` 的 3 個表格（財報／月營收／
  來源明細）套用 `company-finance-table` class，其 `min-width:560px`
  （globals.css 無條件套用）打贏了 `.company-data-table-fit` 的手機卡片轉換
  規則（`min-width:0`，只在 `@media(max-width:768px)` 內），兩者 CSS
  specificity 相同、`.company-finance-table` 在檔案裡宣告在後 → 卡片版面被
  撐到 560px 寬，右半欄位（毛利率／EPS）在 390px 下完全看不到、也沒有橫向
  卷軸可捲（`overflow-x` 被另一條 `:has()` 規則設回 `visible`）。`FullProfilePanels.tsx`
  的表格（沒有這個 class）不受影響、卡片轉換原本就正常。
- 共用元件觸控債（M1 已知留下的 M2 待辦）：header dock 4 顆按鈕 36px、首頁
  「搜尋 ⌘K」按鈕 32px。
- 公司頁觸控偏小：返回按鈕 30px、財報/月營收 tab 36px、日K/週K/月K 切換
  28px、K 線指標 chip 25px、縮放鈕 24px、分頁上一頁/下一頁 28px、知識圖譜/
  上下游圖譜面板「在公司圖譜搜尋」連結 27px（inline style，無 min-height）。

## 修了什麼（全部 `@media (max-width: 480px)`，不影響桌機）

1. **共用元件**（`apps/web/app/globals.css`）：`.header-dock-button` 36→44px；
   `.tac-topbar button`（首頁「搜尋 ⌘K」）補 `min-height:44px`。
2. **財報表格真 bug 修復**（`apps/web/app/globals.css`）：`.company-finance-table`
   在 `@media(max-width:480px)` 內把 `min-width` 重設為 0（`!important`，因為
   同一個 selector 在檔案裡被無條件重複宣告多次，單靠 source order 不可靠），
   讓卡片轉換規則生效；連帶財報/月營收 tab（36→44px）、分頁按鈕
   （28→44px）一併補足觸控高度。
3. **K 線工具列觸控**（`apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`）：
   指標 chip（`_ind-toggle-btn`）25→34px、縮放/回最新等視窗工具鈕 24→34px。
   刻意不頂滿 44px——這排一次擺 8-9 個 chip + 5 個工具鈕，390px 下硬性 44px
   會把大半推到下一行，犧牲這張圖表本已吃緊的垂直空間；34px 已是明顯更好
   摸、且維持每行 3-4 顆的密度，此為刻意的產品密度取捨（已在 CSS 註解說明）。
   `.company-workbench-shell .kline-tab`（日K/週K/月K，globals.css）28→44px
   （這是主要時間刻度切換，非次要工具，值得頂滿標準）。
4. **返回按鈕**（`CompanyPageStyleBlock.tsx`）：`._co-back-btn` 30→44px。
5. **知識圖譜「在公司圖譜搜尋」連結**（`IndustryGraphPanel.tsx` +
   `CoverageKnowledgePanel.tsx` 兩處重複實作都補了 `_ig-graph-search-link`
   class；`CompanyPageStyleBlock.tsx` 補 CSS）：27→44px。
6. **字級**（`CompanyPageStyleBlock.tsx`）：AI 分析鎖定訊息 11/10.5px→13/12px；
   主題卡片名稱/分類 12.5/10px→13/11px。未逐一把 BidAsk/法人/融資券面板的
   密集數字網格（9.5-10.5px）全部頂到 14px——那些是刻意的高密度數字 chip
   排版（類似 K 線指標 chip），跟本頁其餘資料的閱讀密度一致；逐一重排會
   超出本輪「純呈現層、零行為變更」的範圍，列為已知取捨而非遺漏。

## After 實測

- 公司頁 doc scrollWidth 維持 390（無頁面級水平溢出），財報表格 3 個實例卡片
  版面完整落在視窗內、6 個欄位全部可讀。
- 觸控目標清單只剩：K 線指標 chip / 縮放鈕（刻意的 34px 密度取捨，見上）與
  TradingView 版權連結（第三方套件強制顯示的極小 attribution logo，不可改）。
- 首頁/AI推薦/警示三頁（M1 範圍）回歸測過，header-dock 改動未造成任何退步
  （3 頁 doc scrollWidth 皆維持 390、無新增 <44px 目標）。

## 防回歸基線

`packages/qa-playwright/tests/mobile-390.spec.ts` 新增 `/companies/2330`：
- 無頁面級水平溢出 ②關鍵元素可見（K 線面板 + 側欄 BidAsk 面板）③無
  blocking console error。跟既有 3 頁同一個 `ROUTES` 陣列，同一組斷言邏輯。
