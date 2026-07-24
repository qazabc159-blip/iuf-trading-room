# AI 推薦「AI 投研晨報」v2 實作 — 欄位對照表

日期：2026-07-23　實作者：Jim　branch `feat/ai-rec-morning-brief-impl-jim-20260723`
2026-07-24 更新（Jim-3，branch `feat/airec-brief-consume-new-fields-jim3-20260724`）：#1362 補上
`leadSummary`/`themeContext` 兩個後端欄位，補齊下方「已知缺口」#1/#2 —— 欄位對照表 #16/#19 與文末
兩項缺口已從「後端真缺口」改為「LIVE」，統計數字同步更新（見各自欄位列的更新註記）。
設計稿：`reports/design_redesign_20260722/drafts/ai_rec_redesign_v2.html`
真實渲染檔：`apps/web/app/ai-recommendations/page.tsx`（不在 FINAL_V031 shadow rewrite 清單，見 `apps/web/middleware.ts`）

## 統計
- 真接活值欄位：**30**（原 28 + 本輪 leadSummary/themeContext 2 項）
- 誠實省略（非後端缺口，設計稿字面樣板不對應真實欄位）：**0**（頭版 deck 摘要句、資料缺口 gapnote 兩項本輪已分別由 leadSummary/themeContext 補上真值；`themeContext.dataAvailable!==true` 時仍是條件式不渲染，屬「誠實空狀態」而非「無欄位可接」，見 #16/#19 列）
- 後端真缺口（已存在但無法在本輪解決，需開票）：**0**（原 2 項已於 #1362 + 本輪消費端補齊）

**中途修正（本機真渲染驗出，非只憑代碼審查，2026-07-23 原記錄）**：deck 摘要句原規劃「取 why_buy 第一句」屬衍生顯示，實作後用本機 seed 資料真渲染一次，發現真實 AI 敘事段落常常整段只有一個句號在最後——「第一句」等於整段第一段，畫面上會跟下面「推薦理由」第一段逐字重複。設計稿的 deck 是獨立編輯摘要，不是 why_buy 的機械衍生，當時 v3 item 沒有這個欄位，故先省略。**2026-07-24 更新**：#1362 加了獨立的 `leadSummary` 欄位（非機械衍生，backend 端 alias 自 LLM 的 `oneLineReason`），見下表 #16——上述「不參與衍生欄位」的判斷本身沒有錯，只是缺的欄位現在補上了。

## 逐欄對照

| # | 設計稿欄位 | 真實資料來源 | 狀態 |
|---|---|---|---|
| 1 | Masthead 標題「AI 投研晨報」 | 靜態文案 | 靜態（非資料） |
| 2 | 台北時鐘 | `TaipeiClock`（既有元件，import 複用） | LIVE |
| 3 | Ticker tape / Sidebar / Topbar | `app/layout.tsx` 全站共用 `Sidebar`/`HeaderDock`/`TickerTape`（本頁不重建） | LIVE（既有） |
| 4 | 天頭「版次」 | `v3.generatedAt` 日期部分 | LIVE |
| 5 | 天頭「產生」 | `v3.generatedAt` 時間部分（`formatRecommendationTimestamp`，既有 helper 複用） | LIVE |
| 6 | 天頭「市場」（趨勢盤/區間盤/事件窗口/風險收縮） | `getV3MarketScores(v3Items)` → `MarketStateBadge` STATE_CONFIG（既有元件複用） | LIVE |
| 7 | 天頭「執行」SOP 提示 | 同上（MarketStateBadge detail） | LIVE |
| 8 | 天頭「部位係數」 | 同上（MarketStateBadge multiplier） | LIVE |
| 9 | 導言「研究模式」安全提示 | 靜態文案（沿用既有頁面 note 字面精神） | 靜態（非資料） |
| 10 | 追蹤實績 methodology box（隔日/5日/20日勝率、5日平均超額、樣本數、統計期間、總筆數） | `GET /api/v1/admin/ai-rec/performance`（`getAiRecPerformance()`，既有；Owner-only，非 Owner 整塊不渲染） | LIVE |
| 11 | 頭版 band 狀態（正式推薦 N/5 檔／生成狀態／備援補牌／官方公告） | `buildV3PanelState` + `synthesisFlags` + `getOfficialAnnouncementSourceState(v3.data)`（既有 v3-view.ts helper 複用） | LIVE |
| 12 | 公司名／代號／推薦級／序位 | `mapV3ItemToStockRecCard()`（既有）+ 陣列 index（後端回傳順序即排序） | LIVE |
| 13 | 信心 % | `item.confidence` | LIVE（null 時顯示 `--`，不假設） |
| 14 | 總分 /100 | `sub_scores.total` | LIVE |
| 15 | 盤勢係數 | `item.position_sizing.market_multiplier` | LIVE（null 時顯示 `--`） |
| 16 | 頭版 deck 摘要句 | `leadSummary`（#1362，`resolveLeadSummaryText()` in `morning-brief-copy.ts`；null 時顯示誠實 fallback「後端尚未回傳頭版摘要句。」，不留版面空洞） | LIVE（2026-07-24 補；只用於頭版，內頁候選無此版位） |
| 17 | 推薦理由本文（多段） | `why_buy`（`joinLines(why_buy, rationale)`，既有 localizeV3Narrative 複用）按 `\n` 切段 | LIVE |
| 18 | 主要風險（條列） | `risk`（`firstNonEmptyRiskSource(risks, riskFactors, risk, why_not_buy)`，既有）按 `\n` 切段 | LIVE |
| 19 | 資料缺口 gapnote「產業鏈定位資料庫尚無定位…」 | `themeContext`（#1362，`resolveThemeContextDisplay()`）：`dataAvailable===true` 時顯示真實 chainPosition/beneficiaryTier/themes（人話化，見文末說明）；`dataAvailable!==true`（含 null／false）時整塊不渲染，禁止補固定樣板句（Pete-12 review 明確提醒） | LIVE（2026-07-24 補，個股層級，頭版與內頁候選皆有） |
| 20 | 七維評分 box-score（題材/營收/法人ETF/籌碼/RS量/技術/估值/總分） | `sub_scores.{theme_position,revenue_earnings,institutional_etf,margin_short,rs_volume,technical_structure,valuation_event,total}` | LIVE |
| 21 | 交易計畫（進場區間/進場理由/目標一/目標二/停損/風報比） | `entry.{ote_low,ote_high,label}` + `targets.{tp1,tp2,sl,r_value}` | LIVE |
| 22 | byline 資料來源／資料依據 | `displaySource(rec.source)` + `displaySourceTrail(rec.sourceTrail)`（StockRecCard.tsx 既有函式，補 `export` 後複用，函式體零改動） | LIVE |
| 23 | byline 建議單筆／組合上限 | `BUCKET_CONFIG[bucket]`（StockRecCard.tsx 既有常數，補 `export` 後複用） | LIVE（bucket 由真 totalScore 推導） |
| 24 | byline CTA（看公司／加觀察／帶入模擬單） | `LinkageCtaRow`（StockRecCard.tsx 既有元件，原樣 import 複用，含 `addWatchlistSymbol` 真呼叫、`buildV3PrefillHref` 真 handoff） | LIVE |
| 25 | 內頁候選 #2-5 全部同上 12-24 欄位 | 同上，per item | LIVE |
| 26 | 地腳 colophon | 靜態文案 | 靜態（非資料） |
| 27 | AI 公司報告入口 | 沿用既有「看公司」CTA → `/companies/{ticker}` → `AiAnalystReportPanel`（#1341/#1344/#1346/#1347 本週已修通，本輪不改公司頁） | LIVE（既有路由，未變動） |
| 28 | 官方公告狀態 | `getOfficialAnnouncementSourceState(v3.data)`（既有） | LIVE |

## 已知缺口（回報 Elva／Jason）— 已於 2026-07-24 全部補齊

1. ~~主題／供應鏈資料缺口沒有明確 boolean/文字欄位~~ — **已解決**：#1362 加了 `themeContext`（`dataAvailable` boolean + `chainPosition`/`beneficiaryTier`/`themes[]`），verbatim 取自 `get_supply_chain` 早就在查的 `company_graph_db` 資料。前端 `resolveThemeContextDisplay()`（`morning-brief-copy.ts`）：`dataAvailable!==true` 整塊不渲染（不補固定樣板句，Pete-12 review 提醒過）；有資料時把 `beneficiaryTier`/`themes[].lifecycle` 這兩個真封閉 Postgres enum（`packages/db/src/schema.ts` `beneficiaryTierEnum`/`themeLifecycleEnum`）翻成中文，`chainPosition` 是自由文字欄位原樣顯示（不臆測翻譯表，見程式註解）。
2. ~~沒有獨立的「頭版摘要句」欄位~~ — **已解決**：#1362 加了 `leadSummary`（`whyBuyBrief`/LLM `oneLineReason` 的別名，zero marginal cost）。前端 `resolveLeadSummaryText()`：有值原樣顯示；null（deterministic fallback 項目沒有 LLM 一句話理由）時顯示誠實 fallback「後端尚未回傳頭版摘要句。」，不留版面空洞。只用於頭版特稿（MorningBriefLead），內頁候選（MorningBriefStory）沒有這個版位——設計稿本身也只有頭版才有 deck。

### 順手修復（非本輪主目標，驗證時發現）
驗證 themeContext 真渲染時發現：既有 `why_buy`/`rationale` 敘事文字（LLM 生成，system prompt 明確要求模板「受惠層級=[beneficiaryTier]，主題 lifecycle=[lifecycle]」）本來就會把 `beneficiaryTier`/`themes[].lifecycle` 的**原始英文 enum 值**（如 `Observation`/`Discovery`）逐字印出——`apps/web/lib/ui-vocab.ts` 的 `translateNarrativeJargon()` 原本只翻譯欄位名（`chainPosition`→供應鏈定位、`beneficiaryTier`→受惠層級），沒翻譯這 9 個值本身。本輪補上 9 個 enum 值翻譯，並補了直接複製自真實 prod 洩漏文字的回歸測試（`ui-vocab.test.ts`）。

**2026-07-24 Pete-15 review 修正**：這 9 個值同時也是正常財經英文詞彙（Core Holding／Price Discovery／Crowded Trade／配息 Distribution 等），原本的裸字比對（bare `\bWord\b`）會誤翻真實財經敘述。改成只在緊鄰 `=`／`：`／`:` 時才翻譯（真實洩漏文字目前確認的兩種樣態「受惠層級=Observation」「lifecycle=Discovery」都符合這個形狀），犧牲部分 recall（換行/空格/斜線相鄰的洩漏樣態，例如「受益層級 Observation」「NVIDIA/Discovery」，本輪不處理）換取不誤翻真實英文財經詞彙的 precision。**殘留小缺口**（未修，留給下一張小票）：①`lifecycle=` 這個英文欄位名字面（非其值）目前仍未翻譯；②非 `=`／`：` 相鄰的洩漏樣態（空格/斜線分隔）仍會原樣印出。

## 刻意刪除的舊 UI（非本輪功能缺口，是設計換代的必然結果）

- 舊 v1/v2「brain_react」bucket 分桶卡片格（`BUCKETS`/`groupByBucket`/`RecommendationCard`/`QualityBadges`）— 這正是楊董退件的「四不像」版式本體（stat-tile 帶 + chip 列），全面移除，改用 v3 canonical 的頭版/內頁版式。`getRecommendationsToday()`/`RecommendationListEmptyState` 一併移除；`/ai-recommendations/[id]` 詳情頁與 feedback actions 不在本輪範圍內（v3 卡片先前就未連到它們，非本輪造成的迴歸）。
