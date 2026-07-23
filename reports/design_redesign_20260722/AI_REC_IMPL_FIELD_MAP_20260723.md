# AI 推薦「AI 投研晨報」v2 實作 — 欄位對照表

日期：2026-07-23　實作者：Jim　branch `feat/ai-rec-morning-brief-impl-jim-20260723`
設計稿：`reports/design_redesign_20260722/drafts/ai_rec_redesign_v2.html`
真實渲染檔：`apps/web/app/ai-recommendations/page.tsx`（不在 FINAL_V031 shadow rewrite 清單，見 `apps/web/middleware.ts`）

## 統計
- 真接活值欄位：**28**
- 誠實省略（非後端缺口，設計稿字面樣板不對應真實欄位）：**2**（頭版 deck 摘要句、資料缺口 gapnote — 見下方說明）
- 後端真缺口（已存在但無法在本輪解決，需開票）：**1**（見文末）

**中途修正（本機真渲染驗出，非只憑代碼審查）**：deck 摘要句原規劃「取 why_buy 第一句」屬衍生顯示，實作後用本機 seed 資料真渲染一次，發現真實 AI 敘事段落常常整段只有一個句號在最後——「第一句」等於整段第一段，畫面上會跟下面「推薦理由」第一段逐字重複。設計稿的 deck 是獨立編輯摘要，不是 why_buy 的機械衍生，且 v3 item 沒有這個欄位；改為直接省略，不參與衍生欄位，見下表 #16。

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
| 16 | 頭版 deck 摘要句 | **無對應欄位** — 試過「取 why_buy 第一句」衍生，真渲染驗出常與下方推薦理由第一段逐字重複；v3 item 無獨立摘要欄位，已移除 | 誠實省略（見文末缺口②） |
| 17 | 推薦理由本文（多段） | `why_buy`（`joinLines(why_buy, rationale)`，既有 localizeV3Narrative 複用）按 `\n` 切段 | LIVE |
| 18 | 主要風險（條列） | `risk`（`firstNonEmptyRiskSource(risks, riskFactors, risk, why_not_buy)`，既有）按 `\n` 切段 | LIVE |
| 19 | 資料缺口 gapnote「產業鏈定位資料庫尚無定位…」 | **無對應欄位** — 設計稿字面是原始樣本文字，非固定 schema 欄位；已刪除固定樣板框，缺口資訊已隱含在 `why_buy`/`risk` 原生敘事中（AI 產文本就會提及） | 誠實省略（見文末缺口①） |
| 20 | 七維評分 box-score（題材/營收/法人ETF/籌碼/RS量/技術/估值/總分） | `sub_scores.{theme_position,revenue_earnings,institutional_etf,margin_short,rs_volume,technical_structure,valuation_event,total}` | LIVE |
| 21 | 交易計畫（進場區間/進場理由/目標一/目標二/停損/風報比） | `entry.{ote_low,ote_high,label}` + `targets.{tp1,tp2,sl,r_value}` | LIVE |
| 22 | byline 資料來源／資料依據 | `displaySource(rec.source)` + `displaySourceTrail(rec.sourceTrail)`（StockRecCard.tsx 既有函式，補 `export` 後複用，函式體零改動） | LIVE |
| 23 | byline 建議單筆／組合上限 | `BUCKET_CONFIG[bucket]`（StockRecCard.tsx 既有常數，補 `export` 後複用） | LIVE（bucket 由真 totalScore 推導） |
| 24 | byline CTA（看公司／加觀察／帶入模擬單） | `LinkageCtaRow`（StockRecCard.tsx 既有元件，原樣 import 複用，含 `addWatchlistSymbol` 真呼叫、`buildV3PrefillHref` 真 handoff） | LIVE |
| 25 | 內頁候選 #2-5 全部同上 12-24 欄位 | 同上，per item | LIVE |
| 26 | 地腳 colophon | 靜態文案 | 靜態（非資料） |
| 27 | AI 公司報告入口 | 沿用既有「看公司」CTA → `/companies/{ticker}` → `AiAnalystReportPanel`（#1341/#1344/#1346/#1347 本週已修通，本輪不改公司頁） | LIVE（既有路由，未變動） |
| 28 | 官方公告狀態 | `getOfficialAnnouncementSourceState(v3.data)`（既有） | LIVE |

## 已知缺口（回報 Elva／Jason）

1. **主題／供應鏈資料缺口沒有明確 boolean/文字欄位**。v3 item 只有 `subScores.theme`（數字），沒有像 `themeDataGap` 這種欄位可以判斷「供應鏈尚未回傳、主題維持預設 10 分」是否成立。本輪不猜測、不對每張卡片寫死同一句樣板文字，直接移除設計稿裡的固定 gapnote 框；若要恢復固定顯示，需要後端在 v3 item 明確吐出這個狀態欄位。
2. **沒有獨立的「頭版摘要句」欄位**。v3 item 只有 `why_buy`/`rationale`（完整敘事段落），沒有一句話的編輯摘要。設計稿的 deck 是逐字抄自真實歷史報告的獨立摘要句，不是 why_buy 的機械衍生；若要支援，需要後端在生成 v3 item 時額外產出一個 `headline`/`deck` 欄位（例如 LLM synthesis 階段多產一句摘要），前端才有東西可接。

## 刻意刪除的舊 UI（非本輪功能缺口，是設計換代的必然結果）

- 舊 v1/v2「brain_react」bucket 分桶卡片格（`BUCKETS`/`groupByBucket`/`RecommendationCard`/`QualityBadges`）— 這正是楊董退件的「四不像」版式本體（stat-tile 帶 + chip 列），全面移除，改用 v3 canonical 的頭版/內頁版式。`getRecommendationsToday()`/`RecommendationListEmptyState` 一併移除；`/ai-recommendations/[id]` 詳情頁與 feedback actions 不在本輪範圍內（v3 卡片先前就未連到它們，非本輪造成的迴歸）。
