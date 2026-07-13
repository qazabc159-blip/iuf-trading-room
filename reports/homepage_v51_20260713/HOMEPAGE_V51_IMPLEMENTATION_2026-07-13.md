# 首頁 v5.1 LEDGER 揭示板改版 — 實作報告（2026-07-13, Jim）

## 範圍與定位
楊董動員令：「首頁還是舊版的，你給我全部搞好弄好」——把線上舊 A 案（#1215）換成 v5.1
定稿方向。派工訊息指定設計權威來源為 artifact
`https://claude.ai/code/artifact/41de1bc9-45b6-454a-842a-87127fbc496d`。

## 誠實揭露：未能讀取 artifact 原始 HTML/CSS
本次任務環境中**沒有 WebFetch 或任何瀏覽器/網頁擷取工具**可用（我的工具集僅有
Read/Grep/Glob/Bash/Edit/Write）。嘗試以 `curl` 直接抓取 artifact URL，回傳
Cloudflare Turnstile 的 JS challenge 頁（HTTP 200 但內容是 `Just a moment...` 挑戰頁，
需要瀏覽器執行 JS 才能過關），非該 artifact 的實際內容。查閱團隊 memory 與既有
worktree（`project_cockpit_desktop_terminal_density_v2_2026_07_12.md` 等）確認：過去
所有 session 也都未曾成功把這個 artifact 的原始碼落地存檔（楊董都是直接在自己瀏覽器
上用登入態看 artifact 拍板，工程 session 端只留下文字描述 + 反饋紀錄）。

**因此本輪 v5.1 並非逐 pixel 複製 artifact**，而是依：
1. 派工訊息裡的文字規格（LEDGER 揭示板風格：巨型大盤指數錨點＋產業熱力圖頭版、AI 推薦
   頭條、右側新聞電傳紙帶、S1 佈告、排行）
2. 團隊 memory 已定案的設計語彙（`feedback_desktop_terminal_density_no_ai_look`：交易
   終端高密度、去卡片化、去圓角大陰影；`feedback_homepage_is_info_overview`：七塊 IA
   清單鎖定；v5 反饋「去編號、非對稱編排」）
3. 現有已 shipped 的 terminal-density CSS 慣例（`.tac-*` 系列，僅供首頁使用）

重建版面。**這是一個已知落差，需要楊董/Elva 拿實際截圖跟 artifact 原稿肉眼比對定案是否
接受**，不是「已驗證與 artifact 一致」。若不接受，下一輪需要有人用能開瀏覽器的環境把
artifact 內容轉存成可讀檔案（例如楊董自己複製 HTML 原始碼貼給工程 session），才能做到
逐 pixel 還原。

## 實作內容

### IA 七塊鎖定（不加不減，見 memory `feedback_homepage_is_info_overview`）
現有 A 案（#1215）在資料層面其實已經完整覆蓋七塊，本輪**未新增任何資料源**，純粹重排
版面：
1. 大盤總覽 → `HeroPanel`（TAIEX 指數 + 漲跌家數 breadth + 日K折線）
2. 產業熱力圖 → `RealtimeHeatmapPanel`（`IndustryHeatmap` 元件，內部分組/配置**完全未
   動**，遵守楊董 7/13「產業跟配置不要亂改」鐵律）
3. AI 推薦個股 → `AiRecommendationActionPanel`（consume `/ai-recommendations` v3 canonical
   endpoint，與 `/ai-recommendations` 正式頁同一份資料）
4. AI 每日簡報 → `DailyBriefPanel`（consume `/briefs`）
5. 量化策略 S1 → `StrategyPanel`（consume lab strategy snapshot + F-AUTO SIM 實盤績效，
   研究回測與實盤數字並列不混淆，維持既有揭露元件 `TrackRecordDisclosure`）
6. 強勢個股排行 → `MarketMoversPanel`（consume `market/leaders` 漲幅/跌幅/成交活躍）
7. 每日精選新聞 → `MarketIntelPanel`（consume `market-intel/news-top10` +
   `market-intel/announcements`）

`DataHealthPanel`／`BrokerConnectionLine` 為工程遙測小計，非七塊之一，沿用舊排序放頁尾
（沒有更動）。

### 版面重排（LEDGER 頭版語彙）
- **頭版**：新 `.tac-frontpage`（等寬雙欄，`align-items:start` 讓兩欄依內容自然高度，
  不強制拉伸出空白——這就是「非對稱編排」的實際落地方式：欄寬對稱但高度自然不對稱，
  比起硬拉伸出空白區塊更符合「報紙頭版張力」）＝ Hero（巨型指數錨點，數字從 28px 放大
  到 36px）+ 熱力圖並列。
- **AI 推薦頭條**：從原本半寬 `.tac-two-grid` 移到全寬 promoted 位置（緊接頭版之下），
  新增 `.tac-headline-panel` 樣式（品牌色頂線 + 標題放大到 20px + 首檔標的字級加大），
  比照報紙頭條的視覺優先序。
- **編輯正文兩欄**：新 `.tac-editorial-grid`（主欄 1fr / 右軌 300-340px）：
  - 主欄 `.tac-editorial-main`：S1 佈告（`.tac-bulletin-panel`，左側品牌色條，公告欄
    語彙）→ 排行 → AI 簡報，直向堆疊。
  - 右軌 `.tac-news-rail`：`position:sticky`，容納 AI 精選新聞與重大訊息，改造原本
    58px/1fr/60px/70px 橫向四欄表格為兩欄兩列（代號+標題一行／日期+分類第二行）—— 窄
    欄「電傳紙帶」逐行語彙，寬螢幕不再擠壓。
- **去卡片化**：`.tac-panel` 圓角從 8px 收到 2px，移除大型 `box-shadow`（原本
  `0 16px 42px` 的浮動卡片陰影），符合「桌面版=交易終端密度，禁 AI 卡片 dashboard 味」
  鐵律。這個 class 只有首頁使用（已 grep 確認），零跨頁風險。

### 已知、未修的預存問題（非本輪引入）
真瀏覽器對照 prod（`app.eycvector.com`）發現：熱力圖磚格在跟排行/其他面板並列的
~500px 欄寬下，部分磚格文字本來就會互相截斷重疊（例如「3034」「2382」數字被鄰格蓋
住）。**用完全相同的欄寬對 prod 現況截圖比對確認：這個截斷在目前線上 A 案就已存在**
（見 `prod_heatmap_movers_pair.png`），不是本輪重排引入的迴歸。楊董 7/13 明確要求
「產業跟配置那些不要亂改」，本輪未修改 `industry-heatmap.tsx` 任何邏輯或磚格排版，
故此問題原樣保留、如實在此揭露，建議另立小任務處理磚格文字自適應。

## 驗證
- `pnpm typecheck`：15/15 綠
- `pnpm --filter @iuf-trading-room/web test`：681/681 綠（含既有 `page-p1-home-cluster.test.ts`
  等首頁 source-grep 測試，本輪未新增/修改任何 test）
- `pnpm run build:web`：全綠，31 routes 含 `/`
- 真瀏覽器驗證（本機 `next start` 打 `https://api.eycvector.com` + 真 owner session，
  `packages/qa-playwright/tests/mobile-390.spec.ts` 現有 13 條回歸鎖）：**13/13 PASS**
  （含 `/` 首頁 390px 無 page-level 水平溢出）
- Ad-hoc 桌面 1280px + 手機 390px 截圖 + document-level overflow 檢查（非 fullPage 逐
  元素誤報，改用 `document.documentElement.scrollWidth` 真溢出判定）：兩個斷點皆
  `RESULT: CLEAN`，零 JS console error
- 右軌 sticky news rail 曾在 **fullPage** 截圖中看似與 header-dock 通知圖示重疊 ——
  改用真實 viewport（非 fullPage）+ scrollIntoViewIfNeeded 截圖與 `getBoundingClientRect`
  交叉檢查，證實為 Playwright fullPage 對 `position:fixed` 元素的拼接偽影，實際渲染
  無重疊（`intersectsRail:false`，僅 `.tac-scanline` 這種 `pointer-events:none` 的全螢幕
  裝飾層相交，非真內容碰撞）

## 截圖清單（本目錄）
- `before_prod_A_full.png` — 改版前（線上 A 案，1280px fullPage）
- `desktop_1280_full.png` / `desktop_1280_frontpage.png` / `desktop_1280_headline.png` /
  `desktop_1280_editorial.png` / `desktop_1280_rail_viewport_scrolled.png` — 改版後桌面
- `mobile_390_full.png` / `mobile_390_frontpage.png` / `mobile_390_headline.png` /
  `mobile_390_editorial.png` — 改版後手機
- `prod_heatmap_movers_pair.png` — 熱力圖磚格截斷問題的 prod 現況佐證（證明非本輪引入）

## 修改檔案
- `apps/web/app/page.tsx` — DashboardContent 版面重排（`.tac-frontpage` /
  `.tac-editorial-grid` / `.tac-editorial-main` / `.tac-news-rail`），AI 推薦與 S1
  Panel 各加一個修飾 className；**零資料層改動**（所有 fetch/state 邏輯原封不動）。
- `apps/web/app/globals.css` — 新增/調整僅供首頁使用的 `.tac-*` class（`.tac-frontpage`、
  `.tac-editorial-grid`、`.tac-editorial-main`、`.tac-news-rail`、`.tac-headline-panel`、
  `.tac-bulletin-panel`）；`.tac-panel` 圓角/陰影降密度；`.tac-index-main strong` 放大；
  `.tac-intel-list` 改兩欄兩列；1180px 響應式收合清單追加新 class。

## 下一步建議
1. 楊董/Elva 拿本報告截圖跟 artifact 41de1bc9 原稿肉眼比對，若有具體落差（顏色/字級/
   間距/構圖），請直接標註要調整的點——不需要重新整個猜；有落差就是精修，不是重做。
2. 熱力圖磚格文字截斷（pre-existing、已佐證非本輪引入）建議另立小任務，範圍限定在
   `industry-heatmap.tsx` 的磚格內文字自適應/縮寫策略，不涉及分組或資料配置本身。
