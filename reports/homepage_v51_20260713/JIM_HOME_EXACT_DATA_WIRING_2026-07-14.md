# 首頁「原封搬原稿」/home-exact 資料接線報告（Jim，2026-07-14）

## 範圍
接續 `RECOVERY_CHECKPOINT_2026-07-14.md` 的 scaffold（`apps/web/public/home-exact/index.html`，
逐字搬自 artifact 66KB 原稿）。本輪只做「換資料」：加最小 `data-slot` hook + 頁內 inline
`<script>`，**版面／CSS／class／結構完全未動**（改前後桌機 1280 / 手機 390 皆截圖比對過，
一 px 未漂，見下方驗證段落）。同時新增 `/home-exact` 隔離預覽路由，**未動現有 `/` 首頁**。

## Token → 端點對照表

| 區塊 | 欄位 | 端點 | Fallback / 誠實狀態 |
|---|---|---|---|
| 大盤指數錨點 | 加權指數值/漲跌/漲跌%/漲跌家數 | `GET /api/v1/market/overview/kgi` | 無 taiex 或 `sourceState==="unavailable"` → fallback `GET /api/v1/market/overview/twse`，stamp 顯示「MM/DD 收盤」非「即時」；漲跌家數（breadth）只有 kgi 有此欄位，twse fallback 或 kgi 缺此欄位時誠實顯示「尚無漲跌家數統計」 |
| 產業熱力圖 | 磚格（ticker/名稱/漲跌%）、chips、pool 統計 | `GET /api/v1/market/heatmap/kgi-core` | 個股磚格為空 → fallback `GET /api/v1/market/heatmap/twse`（**改為產業彙總粒度**，非個股——twse 端點本身只回產業層級 avgChangePct/stockCount，磚格改顯示產業名稱，footer 誠實註明「改顯示 TWSE 產業彙總」）；兩者皆空顯示原稿既有的「等待真實行情」EMPTY 磚 |
| AI 推薦個股（5 檔） | ticker/公司名/理由/進場區間/停損/TP1/信心/bucket | 新增同源端點 `GET /api/home-exact/recommendations`（伺服端呼叫既有 `getAiRecommendationsV3()` + `deriveHomeAiRecommendationCards()`） | 見下方「AI 推薦刻意的架構決策」 |
| AI 每日簡報 | 狀態徽章/日期/段落標題+內文 | `GET /api/v1/briefs` | 今日無 published brief → 顯示「待產生」，不偽裝新聞 |
| S1 量化面板 | 研究回測累積報酬/最大回撤/狀態 | `GET /api/v1/lab/strategy/cont_liq_v36/snapshot` | 見下方「S1 端點更正」 |
| S1 量化面板 | 實盤模擬累積報酬/觀察起日 | `GET /api/v1/track-record/nav` | 見下方「S1 端點更正」 |
| 強勢個股排行 | 漲/跌幅 TOP5 | `GET /api/v1/market-data/overview` | `leaders.topGainers`/`topLosers`，空陣列顯示「目前沒有可顯示的排行資料」 |
| 新聞電傳紙帶 | 頭條 + trow 列表 | `GET /api/v1/market-intel/news-top10` + `GET /api/v1/market-intel/announcements?days=30&limit=12&scope=market` | AI 精選 + 官方公告合流，皆空顯示「目前沒有可顯示的市場情報」 |
| 時鐘/日期 | 秒級即時鐘 | 純前端 `Intl.DateTimeFormat` Asia/Taipei，與資料抓取無關獨立跳動 | — |

所有端點皆走既有 `/api/ui-final-v031/backend?path=...` 同源代理（帶 cookie），只在
`GET_ALLOWLIST` **新增**以下條目（未動任何既有規則）：
`market/overview/{kgi,twse}`、`market/heatmap/kgi-core`、`ai-recommendations/v3`、
`briefs`、`lab/strategy/[id]/snapshot`、`track-record/nav`、`market-data/overview`。

## 兩項對派工訊息的更正（查證後，非憑印象）

1. **S1 端點**：派工訊息說「全部 5 個數字都來自 `/api/v1/lab/strategy/s1/snapshot`」。實際
   grep `apps/api/src/lab-strategy-snapshot-fetcher.ts` 的 `ALLOWED_STRATEGY_IDS` 只有
   `cont_liq_v36`/`strategy_002`/`strategy_003`，沒有字面 `"s1"`；現行 `/` 首頁
   `page.tsx`（`StrategyPanel`/`loadS1Strategy` 附近）用的正是 `getLabStrategySnapshot("cont_liq_v36")`
   當作「S1」面板的真實資料源。且該端點只有研究回測數字（`headlineMetrics.
   strategyNetAbsoluteReturnPct`／`maxDrawdownNetPct`），**沒有 SIM 實盤數字**——實盤模擬
   累積報酬與觀察起日在現行首頁是另外呼叫 `GET /api/v1/track-record/nav`
   （`summary.cumulativeReturnPct`／`navCurve[0].date`）取得。本輪照現行已驗證過的正確
   組合接線，而非派工訊息簡化過的單一端點說法；已在此報告與 commit message 揭露。
2. **產業熱力圖 fallback 粒度**：`twse` fallback 端點回傳的是**產業彙總**（`industry`/
   `avgChangePct`/`stockCount`），不是個股磚格；原樣呈現（磚格文字改放產業名），非個股→
   個股同構造，footer 文案誠實標示改用彙總資料，非偽裝。

## AI 推薦刻意的架構決策
`deriveHomeAiRecommendationCards()`（bucket=C 排除／「高風險排除」排除／總分<65 排除／
entry-stop-tp 欄位命名）是 `/ai-recommendations` 正式頁與現行 `/` 首頁共用的唯一正式過濾
邏輯。靜態 HTML 頁的 vanilla JS 無法直接 import 這段 server-only TS，若照抄濾除規則等於
「自己發明第二套 payload 語意」（明確禁止）。改法：新增一個極小的同源 JSON 端點
`apps/web/app/api/home-exact/recommendations/route.ts`，伺服端直接呼叫既有
`getAiRecommendationsV3()` + `deriveHomeAiRecommendationCards()` 原樣重用，只吐精簡 JSON。
這是本輪唯一新增的「非純資料轉發」程式碼，範圍刻意壓到最小（29 行）。

## 已知簡化（誠實揭露，非隱藏）
- AI 每日簡報只用 `/briefs` 判斷 published/missing，未接 content-drafts 端點，故無法呈現
  原稿的「待確認」中間態（只有「已發布」／「待產生」二態）；drafts 端點目前不在
  `ui-final-v031` 代理白名單，若要補全需再開一條白名單規則，這輪範圍未做。
- 簡報內文只做了禁字遮蔽（買進/賣出/目標價/必賺/保證/勝率），未複刻 `cleanNarrativeText`/
  `cleanExternalHeadline` 的亂碼偵測與英文過多判斷（較複雜、非本頁核心風險點）。
- 熱力圖磚格成交值「億」單位的原稿 `.meta` 列（如「成交值 1,842 億」）本輪拿掉未渲染——
  不確定 API 回傳 `tradingValue` 的原始單位，寧可不顯示也不猜錯單位造假。
- 「加觀察」CTA 維持原稿裝飾態（無真實 POST watchlist 呼叫）；「看公司」「帶入模擬單」已接
  真實可點連結（`/companies/{ticker}`、`/portfolio?ticker=...&prefill=true&entry=...`）。
- masthead「今日焦點」欄位被兩個獨立 render 函式（大盤/簡報）各自 set 一次，屬 race，最後
  完成者顯示為準——視覺上無害（兩者都是誠實文字），但下一輪可考慮合併成單一 owner。

## 驗證
- `pnpm typecheck`：15/15 綠。
- `pnpm --filter @iuf-trading-room/web test`：681/681 綠（零回歸、零新增測試改動既有案例）。
- `pnpm run build:web`：31 routes 全綠（新增 `/home-exact`、`/api/home-exact/recommendations`）。
- 真瀏覽器（本機 `next start` 打 `https://api.eycvector.com` + 真 SEED_OWNER session，
  cookie domain 改寫套用 localhost，沿用既有 `auth.setup.ts` 機制）：新增
  `packages/qa-playwright/tests/jim_home_exact_preview_20260714.spec.ts` 2/2 desktop-chromium
  PASS——確認真實資料已注入（TAIEX 44,580.73、40 檔熱力圖磚格、5 張真 AI 推薦卡、S1 研究
  回測 +400.89%／SIM 實盤 −0.55%、簡報已發布、新聞紙帶 10 AI/0 公告、5 檔排行）、桌機 1280
  與手機 390 皆零水平溢出、扣除既知與本任務無關的既有 harness 噪音（見下）後零非預期
  console/network 錯誤。
- **既知噪音**（非本輪引入，已在測試中列白名單並附出處）：`/auth/me` 401（local-dev-against-
  prod-API harness 既有現象，`jim_memory.md` 已記錄）；根層 `layout.tsx` 的
  `<TickerTape/>`（`"use client"`，非本輪改動）直接在瀏覽器呼叫
  `getMarketDataOverview()`，該端點不在 `lib/api.ts` 的同源代理白名單內，於此 harness 下對
  `api.eycvector.com` 直打會 401——已用未改動的 `/market-intel` 做對照組重現同一現象，證明
  與本次改動無關。
- 截圖：`reports/qa_playwright_20260714_045132/home-exact-{desktop-1280,mobile-390}_desktop-chromium.png`
  （肉眼確認：漲=紅／跌=綠色階正確、卡片結構與原稿逐字 CSS 一致、無斷版）。

## 修改檔案清單
- `apps/web/public/home-exact/index.html`（加 `data-slot` hook + 頁尾 inline `<script>`；CSS/
  layout 零改動）
- `apps/web/app/home-exact/page.tsx`（新增，`/home-exact` 預覽路由，`FinalOnlyFrame` 崁靜態頁）
- `apps/web/app/api/home-exact/recommendations/route.ts`（新增，重用
  `deriveHomeAiRecommendationCards()` 的極小 JSON 端點）
- `apps/web/app/api/ui-final-v031/backend/route.ts`（`GET_ALLOWLIST` 新增 7 條規則，純
  additive，未動既有規則）
- `packages/qa-playwright/tests/jim_home_exact_preview_20260714.spec.ts`（新增，本輪驗收
  harness）

## 下一步建議（給 Elva）
1. 拿 `/home-exact` 跟 artifact 原稿疊圖驗美術（真資料已就位，可以正式核對美術＋真資料
   兩件事一起做）。
2. 若美術判定「一模一樣」，裁決要不要：(a) 補 content-drafts 白名單讓簡報「待確認」中間態
   可用、(b) 決定磚格成交值單位後補回 `.meta` 顯示、(c) 切 `/` 首頁改指向這份逐字 artifact
   （本輪刻意不做，等美術驗收）。

## 追加修正（2026-07-14 疊圖回饋後）

### 1. 🔴 全屏破口修復
疊圖抓到 `/home-exact` 被崁在 app 側欄＋HeaderDock 裡（走 `FinalOnlyFrame` 的 default 分支，
把 iframe 留在 `.app-main-shell` 內、側欄/header-dock 全留著）。修法：**不動
`components/FinalOnlyFrame.tsx`**（該檔仍被 market-intel/portfolio/ideas 等其他
final-v031 路由共用，任何改動都有回歸風險），改在 `apps/web/app/home-exact/page.tsx`
自己 render 一個專用全屏 iframe wrapper——`position:fixed;inset:0;z-index:2147483000`
蓋過側欄／HeaderDock，`body:has(.iuf-home-exact-fullscreen-frame)` 只在這個頁面掛的
專屬 class 出現時才生效，隱藏 `.app-sidebar/.header-dock/.header-dock-scrim/
.header-dock-drawer/.command-palette/.source-badge`、`.app-main-shell` padding
歸零。因為 scope key 是本頁專屬 class，**零風險波及其他 final-v031 路由**——已用真瀏覽器
對照組驗證 `/market-intel`／`/portfolio` 的 `.app-sidebar` 仍正常渲染（`display!=='none'`）。

### 2. 🟡 TAIEX 44,xxx 資料 sanity 查證結果：後端資料源問題，非前端接線 bug
直接帶真 session cookie curl prod：
```
GET /api/v1/market/overview/kgi  → taiex.value = 44561.4（source: twse_mis_intraday, sourceState: live）
GET /api/v1/market/overview/twse → taiex.value = 44561.4（同一組數字）
```
後端兩個端點都**直接回傳** 44,xxx 這個值，我的前端程式碼是單一欄位讀值
（`taiex.value`），**沒有任何相加/乘 2 的邏輯**——不是前端接線 bug。誠實顯示為既有行為，
未做任何「猜測性除以 2」的假修（那樣反而可能掩蓋真問題或引入我自己的錯誤假設）。
數字量級可疑（44,561 ≈ 原稿 demo 基準值 22,845 的 1.95 倍，接近整數 2 倍；現實世界
TAIEX 約 22-23k），**列為後端資料源 follow-up**，非本輪範圍（`market-data.ts` 為
lane 禁區，不可自行修）。建議 Jason/Elva 查證 `twse_mis_intraday` 這條 quote_session
（7/13 路 B 遷移後）的數值管線是否有單位/倍數問題。

### 驗證（修復後重跑）
- typecheck 15/15、`pnpm --filter web test` 681/681、`build:web` 全綠，跟前一輪相同
  （本次修改零涉及 TS/測試檔）。
- 真瀏覽器（同一 harness）：`jim_home_exact_preview_20260714.spec.ts` 2/2 desktop-chromium
  PASS（加長等待到 heatmap 40 磚格全部到齊才截圖）；新截圖確認**無側欄、無
  HeaderDock 通知鈴/登出按鈕，masthead 頂到左右上緣**——桌機 1280／手機 390 皆同。
  額外對照組驗證（驗完即刪的一次性 spec）：`/market-intel` 與 `/portfolio` 的
  `.app-sidebar` 皆正常渲染、非 `display:none`，證明全屏修法未波及其他 final-v031
  路由。截圖：
  `reports/qa_playwright_20260714_051146/home-exact-{desktop-1280,mobile-390}_desktop-chromium.png`。

### 修改檔案（追加）
- `apps/web/app/home-exact/page.tsx`（改寫：拿掉 `FinalOnlyFrame` 依賴，自建全屏 iframe
  wrapper，scope 靠本頁專屬 class，`components/FinalOnlyFrame.tsx` 本身**完全未動**）
- `packages/qa-playwright/tests/jim_home_exact_preview_20260714.spec.ts`（等待條件加強，
  等 heatmap 磚格到齊才截圖）
