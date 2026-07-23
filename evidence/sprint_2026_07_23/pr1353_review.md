# PR #1353 Desk Review — Pete 2026-07-23

## 1. PR Intent
- `/ai-recommendations` 從 v1/v2「brain_react」分桶卡片格（楊董已退件的「四不像」stat-tile/chip 版式）全面改版為「AI 投研晨報」報紙版式：頭版特稿（rank #1 全資訊）+ 內頁二欄候選（rank #2-5），5 檔全資訊直排，零 `<details>` 展開。設計稿 `reports/design_redesign_20260722/drafts/ai_rec_redesign_v2.html` 楊董已 ACK。
- 資料層宣稱完全沿用既有 v3-view.ts mapping + StockRecCard.tsx 的 LinkageCtaRow，只換呈現層。
- Base：`main`。Head：`feat/ai-rec-morning-brief-impl-jim-20260723`。DRAFT。

## 2. Diff Summary
- 19 檔（+1089/-1488），2 commits（實作 + evidence）。
- 主要改動：新增 `MorningBriefLead.tsx`/`MorningBriefStory.tsx`/`TrackRecordBox.tsx`/`morning-brief-copy.ts`/`rec-card-shared.ts`；`page.tsx` 重寫（async page → sync page + Suspense-wrapped async body）；`StockRecCard.tsx` 抽出 `displaySource`/`displaySourceTrail`/`BUCKET_CONFIG` 到 `rec-card-shared.ts` 再 re-export；3 個 test 檔 + 2 個 Playwright spec；6 張截圖 evidence；1 份欄位對照表。

## 3. IUF Blocker Checklist
- A（kill-switch/real-order）：**PASS** — 全 diff grep `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|kgi\.order\.create|/order/create` 零命中；純前端呈現層改動。
- B（auth/secret）：**PASS** — 無新 endpoint；沿用既有 `getAiRecommendationsV3`/`getAiRecPerformance`（session middleware 未變）；grep 2 commits 全量 patch 無 hardcode secret/token/session id。`TrackRecordBox` 保留既有 Owner-only 403→null 靜默隱藏行為（未變動邏輯）。
- C（state/schema）：**PASS/N/A** — 無 migration；無新 enum/status（`market_risk_off` 是既有值，非本 PR 新增）；無 module-level 可變狀態。
- D（PR hygiene）：**PASS** — title `feat(web): ...` 符合 conventional commits；branch 命名符合 `feat/<主題>-<作者>-<YYYYMMDD>`；DRAFT 起手；PR body 完整列 build/test/CI 結果、欄位對照表連結、escalation 段落誠實列出 2 個已知缺口。
- E（越線）：**PASS** — 只碰 `apps/web/app/ai-recommendations/*` + qa-playwright tests + evidence/reports；未碰 `apps/api`、migrations、真金路徑；未自行 merge/ready。

## 4. 正確性與誠實顯示（①，獨立追查非採信欄位對照表）
逐一追到真程式碼，抽查 10+ 項（超過要求的 8 項）：
- `RunHead`/`BandStatus`（`page.tsx:61-84`）：版次/產生/生成狀態/備援補牌/官方公告，全部 `data?.generatedAt`/`data?.status`/`data?.usedFallback`/`getOfficialAnnouncementSourceState()` 真值，非樣板。
- `MorningBriefLead.tsx:41-43`：信心/總分/盤勢係數綁 `rec.confidence`/`scores.total`/`rec.market_multiplier`，`fmtConfidence`/`fmtScore`/`fmtMultiplier`（`morning-brief-copy.ts:71-89`）null 時一致回 `--`，非假 0。
- 七維評分（`SUB_SCORE_ROWS`，`morning-brief-copy.ts:103-111`）綁 `scores.{theme_position,revenue_earnings,institutional_etf,margin_short,rs_volume,technical_structure,valuation_event}` 真欄位。
- 交易計畫（`entry.{ote_low,ote_high,label}`/`targets.{tp1,tp2,sl,r_value}`）真綁定，`fmtPrice`/`fmtRValue` null 時 `--`。
- `displaySource`/`displaySourceTrail`（`rec-card-shared.ts:26-81`）：`brain_react` 內部字串被映射成「AI 推薦引擎」，未洩漏工程語意到 UI。
- **風險尾句不是 5/5 同一句樣板**（v1 退件主因）：`riskItems = splitParagraphs(rec.risk)` 逐卡讀 `rec.risk` 真值（`MorningBriefLead.tsx:25`/`MorningBriefStory.tsx:24`），肉眼比對截圖 5 檔內容完全不同（緯穎/南亞科/樺漢/台化/旺矽風險段落各自獨立）。
- `TrackRecordBox.tsx`：追蹤實績 4 項指標 + 小樣本誠實 caveat（`smallSample` 分支），沿用既有 `getAiRecPerformance()`，Owner-only 403 靜默隱藏（沿用既有行為未改）。
- 空態誠實性：mobile afterhours 截圖實測 `0/5 檔` + 「推薦引擎尚未回傳可用候選；此頁不會補假股票」，無殘影/無假股票卡片。
- **「誠實省略」2 項核實無殘影**：grep PR branch 全 `.tsx` 檔 `deck|gapnote` 零命中——設計稿的頭版摘要句與資料缺口 gapnote 固定框確實整段移除，非留一個空 div 佔位。

## 5. Base branch 落後 main 3 commit 的交叉檢查（②）
- `git merge-base` 確認 PR branch 落後 `origin/main` 3 commits：`#1348`（backend misc）、`#1351`（sim-go-live audit tool）、`#1352`（`fix(ai-rec-v3): postgres-js .rows 修復 TAIEX EMA60 risk-off 訊號`，同日稍早我已 review APPROVED，見 `evidence/sprint_2026_07_23/pr1352_review.md`）。
- **檔案層無衝突**：#1352 只碰 `apps/api/src/ai-recommendation-v2/orchestrator-v3.ts` + `market-data-tools.ts` + `openalice-email-digest.ts`，與本 PR 的 19 個前端檔零交集，merge 不會炸。
- **功能層有真落差（本輪最重要發現）**：`market_risk_off` 是既有 status 值（`orchestrator-v3.ts:279/2959/3131`），當 `programmatic risk_off_score >= 3`（S1-S5 任一信號含 VIX/DXY/10Y/WTI，不依賴 #1352 修的 TAIEX/S6）觸發時，後端回傳 `items: []` + 一份完整 `finalReportMarkdown`（「市場 risk-off — 暫不推薦新倉（系統程式判斷）」+ 逐信號列點）。**本 PR 新版 `EmptyState`（`page.tsx:86-99`）只有兩支分支**（`itemCount>0` 未達門檻 / `itemCount===0` 引擎尚未回傳），兩者文案都暗示「資料還沒回來」，完全不會顯示 `finalReportMarkdown` 或任何「這是刻意風控保護」的說法；`generationStatusLabel()`（`morning-brief-copy.test.ts:62` 自己的測試就寫「only 'complete' renders as 完成」）把 `market_risk_off` 落進通用「需留意」。
  - **Failure scenario**：空頭日觸發 risk-off（S1-S5 任一即可，隨時可能發生，不必等 #1352 的 S6 生效），交易員看到「推薦引擎尚未回傳可用候選；此頁不會補假股票」，會誤以為 pipeline 掛了/在等資料，而非系統正在執行楊董 SOP 的保護性跳過——這與「缺資料顯 EMPTY/STALE **真原因**」的產品鐵律有落差：真原因不是「沒資料」，是「risk-off 主動跳過」。
  - **非本 PR 新增回歸**：舊版（`buildV3PanelState` fallback 分支）行為更差——它會把 `推薦引擎狀態為 market_risk_off` 這種內部 enum 字面直接印給所有使用者看（工程語意外洩），新版拿掉了這個洩漏，但也把「唯一能傳達真實原因」的管道一起拿掉了。同日稍早我在 `pr1352_review.md` §Findings 🟡#3 已預先點出這個既有 gap 並建議路由給 Jim；本 PR 剛好是 Jim 這輪重寫 ai-recommendations 呈現層的 PR，但 field map 的 escalation 段落沒提到這個項目——屬遺漏而非隱藏（field map 誠實列了另外 2 個缺口，只是沒把這個也列進去）。

## 6. 板規對照（③）
- `<details>`/`<summary>` grep PR branch 全 tsx 檔：**零命中**（舊版 main 上有 4 處 `<details>`，本 PR 移除，符合楊董「零展開」硬要求）。
- stat-tile/meter-bar/chip-list grep：**零命中**。肉眼核對 live 5/5 截圖：七維評分是 `<table class="boxscore">`、交易計畫是 `<table class="plan">`，非 chip 列/meter 陣列。
- 已打磨元件複用（非重寫）：`LinkageCtaRow`/`displaySource`/`displaySourceTrail`/`BUCKET_CONFIG` 原樣抽出到 `rec-card-shared.ts` 後 import 回來（`StockRecCard.tsx:7,10` re-export 供 compat），比對函式體逐行零改動，只解決「Server Component 不能呼叫 client-boundary 檔案裡的 plain function」的邊界問題（commit message 有記載真渲染時抓到的錯誤訊息，非事後編造）。
- 禁字 grep（approved/alpha confirmed/live-ready/可以跟單/保證獲利）於所有改動 ts/tsx：**零命中**。

## 7. SSR/效能（④）
- **實為改善，非退化**：diff 顯示舊版 `export default async function AiRecommendationsPage()` 整頁 `await Promise.all([...4 個 fetch])` 才回應——全頁對 4 個資料源都是 SSR 阻塞路徑。新版 `export default function AiRecommendationsPage()`（同步）立即回 masthead/lede/`MarketStateBanner`，資料相關內容（`MorningBriefBody`）包進 `<Suspense fallback=<MorningBriefBodyFallback />>`，串流回應——首屏不再等資料。此改動方向正確且比舊版更輕量，未量測到具體 ms 數字但架構上是純增益，不判定為需要補量測的「SSR 資料改動」（沒有新增阻塞，只有移除阻塞）。
- `MarketStateBanner` 由舊版傳 `lastCloseDate` prop（SSR 端 `resolveBannerLastCloseDate()` 預先算好）改為不傳——查證 `MarketStateBanner.tsx:38/51-71`：`lastCloseDate` 本為 optional prop，未傳時元件自己 `useEffect` client-side fetch `getMarketDataOverview()` 取得同等資訊（文件註解已預期此 fallback path），非破壞行為，只是新增一次可能與 `TickerTape` 重疊的 client 端請求（🟡，非 blocker）。

## 8. 安全（⑤）
- PR 只有 2 個 commit（實作 + evidence docs），`git log -p origin/main..pr-1353-review` 全量掃描 `session[_-]?token|authorization:\s*bearer|api[_-]?key|password|pwd=|cookie:` 等樣式：**零命中**。作者自述刪除的含 token scratch 檔从未進入任何 commit 的說法查證屬實（只有 2 commits，皆已核對乾淨）。

## Findings — Priority Ranked

### 🔴 Blockers
無。

### 🟡 Suggestions
1. **`market_risk_off` 狀態沒有專屬文案，會被誤讀成資料管線問題**（§5）。新版 `EmptyState` 兩支泛用分支都暗示「還沒有資料」，但 `market_risk_off` 的真原因是系統主動風控跳過，且觸發不需要等 #1352 的 TAIEX/S6 訊號（S1-S5 任一即可，隨時可能在空頭日發生）。建議在 `morning-brief-copy.ts`/`page.tsx` 加一個獨立分支：`status === "market_risk_off"` → 正向措辭「市場風控啟動，暫緩新倉」+ 可選擇性帶出 `marketRiskOffScore`。非本 PR 阻塞項（沿用既有 gap，非新增回歸），但因為 #1352 剛好同日先合，這個狀態現在比昨天更容易被真實觸發，建議儘快排 follow-up。
2. `MarketStateBanner` 不再傳 `lastCloseDate`，改為元件自己 client-side fetch（§7）——功能上不是回歸（元件本就支援這個 fallback），但會新增一次與 `TickerTape` 重疊的請求；若要優化可考慮沿用舊版預先算好再傳入。

### 💭 Nits
1. `ai-recommendations.spec.ts` 斷言 `.lead, .story` DOM 數量等於 `payload.items.length`（後端原始 items 陣列長度），而頁面實際渲染邏輯是 `.filter(isActionableV3Item).slice(0,5)`——若某天後端回傳 >5 筆或含被排除的 C 級項目，這個斷言可能與畫面實際渲染數量不一致而假紅（目前 CI 綠是因為測試當下資料剛好一致）。建議未來改成對 `payload.items.filter(isActionable)` 比對，而非原始陣列長度。

### ✅ Praise
- SSR 架構改善確實：舊版整頁 await 4 個資料源才回應，新版拆出 Suspense 邊界讓首屏不再等資料，方向正確且是本 PR 的加分項（§7）。
- 5 檔風險/推薦理由段落逐卡真的不同（非 v1 退件主因的同句樣板），肉眼截圖核對屬實。
- 「誠實省略」2 項（頭版摘要句、gapnote）真的做到零殘影，commit message 誠實記載「本機真渲染抓到會逐字重複」的具體發現過程，不是憑空猜測就砍功能。
- 已打磨元件複用紀律良好：`rec-card-shared.ts` 抽出理由（RSC 不能呼叫 client-boundary 檔案的函式）有具體錯誤訊息佐證，函式體零改動，符合 7/14 教訓。

## 5. Verdict
- [x] **APPROVED** — 可 ready，0 🔴。2 🟡 建議列 follow-up（#1 建議儘快排，因 #1352 同日已使 market_risk_off 更易觸發），不阻擋本次 merge。

## 6. Suggested Owner for Fixes
- 🟡 #1（`market_risk_off` 專屬文案）→ Jim（延續本 PR 的呈現層）
- 🟡 #2（`MarketStateBanner` prop 效率）→ Jim（可選）
- 💭 #1（Playwright 斷言精確度）→ Jim（可選）

## 7. Re-review Required
NO（0 blocker，2 🟡 為 follow-up 非重審條件）

---
Reviewer: Pete
Date: 2026-07-23
Sprint: W6 Day (paper sprint, 2026-07-23)
