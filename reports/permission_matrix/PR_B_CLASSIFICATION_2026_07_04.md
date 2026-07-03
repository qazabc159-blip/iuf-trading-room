# PR-B — 51 處 READ_DRAFT_ROLES 逐一分類（2026-07-04）

依 `PERMISSION_MATRIX_v1.md`「PR-B 分類程序」：每處先讀 handler 實際回什麼資料，
再問「含內部治理/審計/策略內部/執行旗標嗎」— 含或不確定＝不降（fail-closed）。
禁用端點名關鍵字分類；下表理由欄為讀 handler 後的實證，不是端點名推測。

降級寫法：一律移除該 handler 的 `const role = ...` + `if (!READ_DRAFT_ROLES.has(role))`
三行區塊（確認 `role` 變數在該 handler 內無其他用途才移除），改為 session 中介層已保證的
登入即可（Viewer 為階梯最低層，無需額外 `requireMinRole` 包裝）。留的 51-22=29 處零改動。

統計：**降 22 ／ 留 29 ／ 51/51 齊**。

## 降級（22）— G-PUB 純行情/產品讀取

| # | 端點 | 判定 | 理由（handler 讀後證據） |
|---|---|---|---|
| 1 | `GET /api/v1/realtime/snapshot` | 降 | TWSE MIS intraday + STOCK_DAY_ALL EOD 報價快照，欄位僅 symbol/price/freshness_mode，無治理/審計/策略內部/執行旗標 |
| 2 | `GET /api/v1/briefs/search` | 降 | FTS 只查 `status IN ('published','approved')` 簡報全文，不含 auditChain；姊妹端點 `GET /api/v1/briefs`（list）本就零角色檢查 |
| 3 | `GET /api/v1/announcements` | 降 | 官方重大訊息（tw_announcements）+ FinMind tw_stock_news fallback，純市場公告 |
| 4 | `GET /api/v1/sources` | 降 | 8 固定來源（finmind/kline/company/openalice/topic/strategy/signal/news）新鮮度狀態（live/stale/empty），無治理內容，屬產品誠實揭露機制的一部分 |
| 5 | `GET /api/v1/finmind/health` | 降 | 供應商配額/circuit 狀態；handler 內明註「HARD LINE: never return token」，sponsor 欄位僅顯示模糊 tier 標籤 |
| 6 | `GET /api/v1/quotes` | 降 | 純報價（KGI 通道未開通，目前為固定空結構 stub：`sourceState:"empty"`），無帳戶/內部資料 |
| 7 | `GET /api/v1/breadth` | 降 | 純漲跌家數市場寬度（TWSE STOCK_DAY_ALL / companies_ohlcv fallback） |
| 8 | `GET /api/v1/heatmap` | 降 | 純產業熱力圖 tile（TWSE 官方產業分類 + OHLCV fallback） |
| 9 | `GET /api/v1/market/overview/twse` | 降 | 純大盤/櫃買指數（MIS 盤中 + TWSE EOD chain） |
| 10 | `GET /api/v1/market/heatmap/twse` | 降 | 純產業熱力圖（同 #8 資料源） |
| 11 | `GET /api/v1/market/overview/kgi` | 降 | 純指數資料（KGI tick → MIS → TWSE EOD 三層 fallback），無帳戶/憑證欄位 |
| 12 | `GET /api/v1/market/heatmap/kgi-core` | 降 | 純個股熱力圖 tile（KGI tick / MIS / TWSE EOD / cache 四層 fallback），無帳戶資料 |
| 13 | `GET /api/v1/portfolio/preview` | 降 | 紙上模擬現金基數 + FILLED 買單持倉數，回應含 `"紙上預覽,不連真實券商"`；對齊 D3 G-PORT 讀=Viewer |
| 14 | `GET /api/v1/vendor/strategy/ideas` | 降 | 重用 `getStrategyIdeas()`，與零角色檢查的 `/api/v1/strategy/ideas`、`/api/v1/signals` 同源資料，僅轉為產品文案格式（stance/confidence/reason）；「訊號」屬 D3 G-PUB 清單項目 |
| 15 | `GET /api/v1/market/breadth/twse` | 降 | 純市場寬度（漲跌家數/前 20 大量能） |
| 16 | `GET /api/v1/market/leaders/twse` | 降 | 純漲跌幅/成交量排行 |
| 17 | `GET /api/v1/market/heatmap/finmind` | 降 | 純產業熱力圖（FinMind 全市場價格 → 產業聚合） |
| 18 | `GET /api/v1/market/breadth/finmind` | 降 | 純市場寬度（FinMind 主 → TWSE fallback） |
| 19 | `GET /api/v1/market/leaders/finmind` | 降 | 純漲跌幅排行（FinMind） |
| 20 | `GET /api/v1/market/institutional-summary/finmind` | 降 | 三大法人買賣超彙總，TWSE 每日公開資料，無治理欄位 |
| 21 | `GET /api/v1/market/margin-summary/finmind` | 降 | 融資融券餘額彙總，TWSE 每日公開資料 |
| 22 | `GET /api/v1/market/news/finmind` | 降 | 市場新聞列表，純公開資料 |

## 留（29）— 含治理/審計/策略內部/執行旗標，或屬預分類豁免清單

| # | 端點 | 判定 | 理由（handler 讀後證據） |
|---|---|---|---|
| 23 | `GET /api/v1/content-drafts` | 留 | handler 上方註解明載「Drafts may contain unreviewed LLM payload + internal research」— READ_DRAFT_ROLES 原始本意，Viewer 讀取待欄位級遮罩（楊董 2026-04-25 裁示） |
| 24 | `GET /api/v1/lab/strategy-snapshot` | 留 | Lab 治理候選策略快照：sprintId、status 逐字保留、researchOnly 旗標 — 策略內部治理資料 |
| 25 | `GET /api/v1/lab/strategies` | 留 | strategy-snapshot 的路徑別名，同一 handler 邏輯，同一判定 |
| 26 | `GET /api/v1/lab/three-strategy/health` | 留 | three-strategy fixture 群組（20 端點，見下）— 策略內部資料，非公開產品讀取 |
| 27 | `GET /api/v1/lab/three-strategy/status` | 留 | 同上 |
| 28 | `GET /api/v1/lab/three-strategy/files` | 留 | 同上 |
| 29 | `GET /api/v1/lab/three-strategy/strategies` | 留 | 同上 |
| 30 | `GET /api/v1/lab/three-strategy/signals` | 留 | 同上（策略訊號屬內部研究，非 D3 G-PUB「訊號」— 該群組另有 fixture_label=PAPER_FIXTURE 治理標記） |
| 31 | `GET /api/v1/lab/three-strategy/paper-orders` | 留 | 同上，含委託/執行內部資料 |
| 32 | `GET /api/v1/lab/three-strategy/positions` | 留 | 同上，含持倉內部資料 |
| 33 | `GET /api/v1/lab/three-strategy/risk-events` | 留 | 同上，風控事件＝執行旗標類 |
| 34 | `GET /api/v1/lab/three-strategy/risk-config` | 留 | 同上，風控參數＝執行旗標類 |
| 35 | `GET /api/v1/lab/three-strategy/daily-health` | 留 | 同上 |
| 36 | `GET /api/v1/lab/three-strategy/next-signal-readiness` | 留 | 同上 |
| 37 | `GET /api/v1/lab/three-strategy/frozen-signal-snapshot` | 留 | 同上 |
| 38 | `GET /api/v1/lab/three-strategy/main-overlay-validation` | 留 | 同上 |
| 39 | `GET /api/v1/lab/three-strategy/cont-liq-canary-guard` | 留 | 同上，canary guard＝執行旗標類 |
| 40 | `GET /api/v1/lab/three-strategy/quality-scorecard` | 留 | 同上 |
| 41 | `GET /api/v1/lab/three-strategy/decision-matrix` | 留 | 同上，決策矩陣＝策略內部 |
| 42 | `GET /api/v1/lab/three-strategy/execution-board` | 留 | 同上，execution board＝執行旗標類 |
| 43 | `GET /api/v1/lab/three-strategy/position-sensitivity` | 留 | 同上 |
| 44 | `GET /api/v1/lab/three-strategy/master-index` | 留 | 同上 |
| 45 | `GET /api/v1/lab/three-strategy/snapshot` | 留 | 同上，完整 fixture 快照 |
| 46 | `GET /api/v1/lab/strategy/:strategyId/snapshot` | 留 | 回應含 `brokerWriteAllowed`/`realOrderAllowed`/`registryChangeAllowed` 三個明確執行旗標欄位 |
| 47 | `GET /api/v1/briefs/:id` | 留 | 預分類豁免清單：回傳 auditChain（hardReject／adversarialReview／hallucinationCheck），2026-04-25 楊董裁示需欄位級遮罩才能給 Viewer |
| 48 | `GET /api/v1/meta` | 留 | 回應含 `executionMode` 衍生的 mode 文案與 `formalOrder.state`（blocked/reason）— 執行旗標類 |
| 49 | `GET /api/v1/openalice/status` | 留 | 曝內容審核 pipeline 內部狀態：`aiReview.waiting`（待審筆數）、`reviewerVerdict`、`sourceTrail.missing` — 屬編輯治理/審計類，與 content-drafts 審核流程同族 |
| 50 | `GET /api/v1/paper/e2e` | 留 | 預分類豁免清單：曝 kill-switch/執行旗標（submitGateOpen/KillSwitch 狀態） |
| 51 | `GET /api/v1/dashboard/snapshot` | 留 | 預分類豁免清單：聚合 fan-out 含 audit_stats + lab_strategies 面板，整端點降級＝連坐外洩其他已鎖面板 |

## 驗證

- 51/51 齊：降 22 + 留 29 = 51，與 `server.ts` 內 `if (!READ_DRAFT_ROLES.has(role))` 檢查數一致（改動前 grep 計數 51，改動後剩 29）。
- 三個豁免清單端點（`/briefs/:id`、`/dashboard/snapshot`、`/paper/e2e`）維持 Analyst+，未降級。
- 零關鍵字分類：三個表面上像「純行情」但實際含執行旗標的端點（`/lab/strategy/:strategyId/snapshot`、`/meta`）與一個表面像「狀態頁」但實際含審核治理內容的端點（`/openalice/status`）皆判定「留」，證明分類是讀 handler 而非讀端點名。
