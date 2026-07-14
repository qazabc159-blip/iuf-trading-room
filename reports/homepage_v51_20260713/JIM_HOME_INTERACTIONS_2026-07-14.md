# 首頁互動全接＋文字密度壓回原稿水準（Jim，2026-07-14）

## 範圍
接續 `JIM_HOME_EXACT_DATA_WIRING_2026-07-14.md` 的資料接線。本輪只改
`apps/web/public/home-exact/index.html`（版面／CSS class／字級／色彩完全未動，只加
互動行為＋文字截斷邏輯＋一支新驗收 spec）。未碰 `/desk-exact`（另一位 Jim 的 lane）。

## 任務 0（楊董追加，優先）：文字密度壓回原稿水準
真 API 回傳的長文（推薦理由全文、簡報段落全文）撐爆了原稿本來緊湊的排版，造成
「AI 推薦」欄與「AI 每日簡報」欄高度失衡，露出大片空白。修法是**顯示層真截斷**（非
CSS `line-clamp` 遮蓋），資料本體不動：

- `firstSentence(text, maxLen)`：取第一句（「。」／「；」前），若仍超過 `maxLen`
  （AI 推薦理由用 40）才硬截斷加「…」，斷點優先落在「，」「、」空白邊界。
- `firstSentences(text, maxSentences, maxLen)`：簡報段落預設節錄前 2 句、上限 80 字，
  同樣硬截斷邏輯。
- `truncatePlain(text, maxLen)`：新聞標題無標點可循，純長度截斷（feat 標題 34 字、
  trow 列標題 34 字）。
- 簡報「展開全文 ▸」現在是**真正的 client 狀態切換**（`briefState.expanded`），點擊
  即時把每段從節錄字串換成完整原文（`toggleBriefBody`/`renderBriefBody`），非重打
  API、非 CSS 高度收合把戲。收合時按鈕文字「展開全文 ▸」，展開後變「收合 ▴」。

驗證（真瀏覽器截圖）：`reports/homepage_v51_20260713/interactions_20260714/
brief-before-expand_desktop-chromium.png`（AI推薦欄與AI每日簡報欄高度目視平衡，
無殘留空白）vs `brief-after-expand_desktop-chromium.png`（展開後簡報欄自然變長，
屬預期 UX，非 bug）。實測真資料：推薦理由截斷後 `"技術面7/09收盤181.5，明顯站上
月線153.19與季線112.03…"`（39 字）；簡報節錄 `"台股昨日以 45380.52 點作收，上漲
25.91 點、漲幅 0.06%，指數表面維持高檔整理，但盤面內部已不是單純多頭擴散…"`
（約 52 字，符合「首段＋節錄」密度）；展開後完整全文正確顯示（含後續 3 段完整內容）。
高度平衡在預設（收合）態下已達成，未需額外 `align-items:start` CSS 补丁——收合後
兩欄自然份量相近，未觀察到殘留空白。

## 任務 1：互動全接
1. **AI 推薦卡三顆鈕**：
   - 「看公司」→ `<a href="/companies/<ticker>" target="_top">`（top-level 導航，
     真瀏覽器驗證點擊後 `page.url()` 確實變成 `/companies/1303`）。
   - 「帶入模擬單」→ `<a href="/desk-exact?symbol=<ticker>&side=buy" target="_top">`
     （依派工訊息新契約；不再指向舊 `/portfolio?ticker=...&prefill=true`——舊契約隨
     交易台換版已停用，desk-exact 側 query 消費由另一位 Jim 負責，本輪只負責發
     正確格式）。
   - 「加觀察」→ grep 到既有 `POST /api/v1/watchlist`（idempotent upsert，
     `server.ts:6551`）且**已經在** `ui-final-v031/backend` proxy 的 `POST_ALLOWLIST`
     內（`/^\/api\/v1\/watchlist(?:\/remove)?(?:\?|$)/`）——不用改 proxy，直接真接
     線。點擊即時 `POST {symbol, name}`，成功後鈕文字變「已加入 ✓」並鎖住重複點擊；
     失敗則還原文字＋`title` 提示。真瀏覽器驗證：攔截該 POST response 確認 200，
     UI 正確顯示「已加入 ✓」。
2. **熱力圖磚**：個股磚（`kgi-core` 有 symbol 時）加 `data-symbol` + `title="名稱 漲跌%"`，
   點擊 `window.top.location.href = /companies/<symbol>`；純產業彙總 fallback 磚（無
   個股 symbol）只加 hover title，不可點（避免導向不存在的個股頁）。真瀏覽器驗證：
   點擊磚格確實跳轉 `/companies/2330`，`title` 屬性正確含名稱+漲跌%。
3. **新聞紙帶**：`news-top10`/`announcements` 兩個上游本來就有 `url` 欄位（此前前端
   沒有 pass through），現在 map 進來；有 `url` 的項目渲染成 `<a href target="_blank"
   rel="noopener">`（外部站點開新分頁），無 `url` 的維持純文字 `<div>`。真瀏覽器驗證：
   當日 feat 頭條剛好無 url（`feat-href: null`），測試正確跳過 target/rel 斷言（誠實
   反映真資料狀態，非測試造假）；標題長度截斷至 34 字內。
4. **排行列**：`.r` 加 `data-symbol`，點擊跳轉 `/companies/<symbol>`（真瀏覽器驗證
   `6243` 正確跳轉）。
5. **簡報「展開全文」**：見任務 0（同一個修法）。
6. **S1 面板**：`.s1wrap` 整塊加 `cursor:pointer`，點擊跳轉 `/quant-strategies`
   （真瀏覽器驗證）。

## 任務 3：漲跌家數 EMPTY 查證結果——維持誠實 EMPTY
查證 `apps/api/src/data-sources/twse-openapi-client.ts` 的 `TwseMarketOverviewResult`
interface（`GET /api/v1/market/overview/twse` 的回傳型別）：只有
`{ taiex, otc, source, staleAfterSec, _isLkg? }`，**結構上完全沒有 `breadth` 欄位**
（`up`/`down`/`flat` 這組漲跌家數只在 `kgi` overview 的 `breadth` 物件、以及獨立的
`/api/v1/breadth`、`/api/v1/market/breadth/twse` 端點才有）。現行前端邏輯（未改動）
本來就是 kgi live 時讀 `kgi.breadth`，kgi 不可用 fallback 到 twse 時 `breadth = null`
顯示「尚無漲跌家數統計」——這是誠實反映 twse fallback 源頭真的沒有這個欄位，不是
前端漏接。派工訊息明確要求「真沒有就維持誠實 EMPTY」，故未改動此區塊、未新增呼叫
`/api/v1/breadth` 之類的額外端點（超出本輪指定查證範圍，如需接上待 Elva/楊董裁決
是否要多打一支端點）。

## 修改檔案清單
- `apps/web/public/home-exact/index.html`：
  - CSS 新增 `#interaction-affordances`（`.tile[data-symbol]`/`.rk .r[data-symbol]`
    cursor:pointer、`.s1wrap` cursor:pointer、`.tape .trow` display:block 供 `<a>`
    版本使用）。
  - 簡報「展開全文」`<a>` 加 `data-slot="brief-toggle"` + `href="#"`（桌面/手機兩處）。
  - `apiFetch()` 擴充支援 `{method, body}`（向後相容，既有呼叫零改動）。
  - 新增文字截斷 helper（`splitZhSentences`/`hardTruncate`/`firstSentence`/
    `firstSentences`/`truncatePlain`）、`addToWatchlist()`、全域點擊代理
    （熱力圖磚／排行列／S1 面板／加觀察／簡報展開收合）。
  - `renderHeatmap()`：兩個分支（個股/產業彙總）皆加 `title`；個股分支加
    `data-symbol`。
  - `renderRecommendations()`：理由套用 `firstSentence(...,40)`；三顆鈕改用
    `target="_top"` + 新 `/desk-exact` 契約 + `data-watch-symbol`/`data-watch-name`。
  - `renderBrief()`/新 `renderBriefBody()`：`briefState` 保存 `{heading, full,
    preview}`，toggle 純 client 切換。
  - `rowsHtml()`（排行）加 `data-symbol`。
  - `renderNews()`：`url` pass-through、`truncatePlain` 標題截斷、feat/trow 依 `url`
    有無切換 `<a>`/`<div>`。
- `packages/qa-playwright/tests/jim_home_interactions_20260714.spec.ts`（新增，本輪
  互動驗收 harness）。

## 驗證
- `pnpm typecheck`：15/15 綠。
- `pnpm --filter @iuf-trading-room/web test`：680/680 綠（零回歸，零測試改動）。
- `pnpm run build:web`：全綠（含 `/home-exact`、`/`）。
- 真瀏覽器（本機 `next start -p 3211` 打 `https://api.eycvector.com` + 真 SEED_OWNER
  session，railway CLI 取得，`auth.setup.ts` 沿用既有機制）：
  - `jim_home_interactions_20260714.spec.ts` 6/6 desktop-chromium PASS（brief
    toggle／推薦卡三鈕含真 POST watchlist／熱力圖磚跳轉／排行列跳轉／S1 面板跳轉／
    新聞紙帶連結與標題截斷）。
  - 既有 `jim_home_exact_preview_20260714.spec.ts` 2/2 重跑仍 PASS（零回歸：資料
    hydration、零水平溢出、零非預期 console/network 錯誤）。
  - 截圖：`reports/homepage_v51_20260713/interactions_20260714/`（含展開前/展開後
    對照，驗證空白消失＋toggle 正確運作）。

## 已知簡化 / 殘留項（誠實揭露）
- 熱力圖個股磚目前 `kgi-core` 上游回傳完全沒有 `name` 欄位（curl 直查 prod 確認：
  只有 `symbol/price/change/changePct/tier/ts/sourceState/sourceLabel`），磚格與
  `title` 皆 fallback 顯示代號本身——這是既有資料缺口（非本輪引入，原本渲染邏輯
  `t.name ? ... : ""` 早已這樣處理），如需補公司名要在後端 heatmap 端點補
  join，超出本輪範圍。
- 新聞 `url` 欄位並非每則都有（本輪驗證當下 feat 頭條剛好 `url: null`）——這是上游
  資料真實狀態，前端已正確處理（無 url 時不裝連結，不偽造可點假象）。
- 漲跌家數 EMPTY 維持不變（見任務 3），如需真正解決需要 Elva/楊董裁決是否要多接
  一支 `/api/v1/breadth` 或 `/api/v1/market/breadth/twse`（不在本輪指定查證範圍）。

## 下一步建議（給 Elva）
1. 若要把漲跌家數在 twse-fallback（收盤/非 KGI-live）情境下也顯示真值，需明確 ACK
   讓我多接一支 `/api/v1/breadth` 或 `/api/v1/market/breadth/twse`（非本輪範圍，
   backend 端點已存在，純前端 consume 決策）。
2. 熱力圖個股磚公司名缺口回報給 Jason／backend lane 評估是否要在 `kgi-core` 回應
   補 join `companies.name`（本輪只在前端做誠實 fallback，未動 backend）。
