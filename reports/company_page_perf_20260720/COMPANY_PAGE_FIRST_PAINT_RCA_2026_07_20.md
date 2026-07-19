# 公司頁首屏效能 RCA + 修復報告 — 2026-07-20（Jason）

## 症狀
Elva 走查判定 `/companies/2330`（及 4904 / 3008）networkidle 後仍骨架，10.7s 才有內容 — 用戶體感「頁面死了」。

## 根因（curl 交叉驗證，owner session 打 prod API，非記憶推論）

`apps/web/app/companies/[symbol]/page.tsx` 是 server component，第一版一次性 `await` 完
company → OHLCV → `Promise.allSettled([kbar, themes, announcements, realtime, full-profile])`
才 `return` JSX；`loading.tsx` 早已承認這是「3-fetch waterfall」但沒有真的用 Suspense 拆解，
所以骨架顯示時間 = 最慢那支 API 的時間，而不是 hero 需要的那幾支快 API 的時間。

實測（登入 owner session，直接打 prod `api.eycvector.com`，冷啟動 = 該日尚未被打過的 symbol）：

| API（page.tsx 呼叫點） | 2330 | 4904 | 3008 | 用途 |
|---|---|---|---|---|
| `GET /api/v1/companies?ticker=X`（`getCompanyByTicker`） | 0.78s | ~0.5s | ~0.5s | hero 名稱/代號 |
| `GET /api/v1/companies/:id/ohlcv?interval=1d`（`getCompanyOhlcv`） | 0.46s | 0.42s | 0.44s | 日線 K 線 + hero 報價 fallback |
| `GET /api/v1/companies/:id/kbar?date=...&days=20`（`getCompanyKBar`，**freq 預設 1m**） | **7.95s（冷）→ 1.3-1.9s（暖）** | **7.93s（冷）** | **7.55s（冷）** | 僅供「分K」toggle（1/5/15/60分）與逐筆成交面板，**非預設日線視圖** |
| `GET /api/v1/themes` | 0.38s | — | — | 主題受惠標籤 |
| `GET /api/v1/companies/:id/announcements?days=30` | 1.35s | 1.04s | 1.07s | 側欄資料來源狀態 badge |
| `GET /api/v1/companies/:id/quote/realtime` | 1.46s | 1.46s | 1.18s | hero 即時報價 |
| `GET /api/v1/companies/:id/full-profile` | 0.69s | 1.20s | 0.64s | hero KPI（本益比/殖利率/月營收/市值/PBR） |

**kbar 是唯一的離群值**，三檔冷啟動皆 ~7.5-8s，跟 Elva 量到的 ~10s 首屏時間量級一致
（company 0.5-0.8s 序列 + ohlcv 0.4-0.5s 序列 + kbar 7.5-8s 並行但仍是 `allSettled` 最慢者
= 主導 Phase 2 的等待時間）。

### 為什麼 kbar 這麼慢
`apps/api/src/server.ts` 的 `GET /api/v1/companies/:id/kbar`：`freq` 預設 `"1m"`（page.tsx 呼叫
時沒帶 `freq` 參數），走進「FinMind 即時分 K」分支——對 `recentKBarDateCandidates` 產生的最多
`max(12, days*3+10)=70` 個候選交易日，**逐一 `await client.getStockKBar(stockId, candidateDate)`**
（`for` 迴圈序列呼叫，非平行），直到湊滿 `query.days`（20）天有資料才停。每個候選日若未命中
Redis cache（`finmind:kbar:<stockId>:<date>`，`TTL_KBAR`），就是一次真實 FinMind API round-trip；
週末/假日/尚無資料的近期交易日會連續 miss，導致序列疊加成 7-8 秒。**這條路徑本來就只有在使用者
手動切到分K視圖，或捲動到「逐筆成交明細」面板時才用得到**——`OhlcvCandlestickChart.tsx` 預設
`interval` state 是 `"1d"`（日線），`kbarRows` 只在使用者切到 intraday 視圖時才派上用場
（見該檔 line 1125/1217/1264 一帶）——但原本的寫法把它塞進了阻塞整頁首次渲染的
`Promise.allSettled`，等於讓「非必要、非預設視圖」的資料拖垮「必要、預設可見」的 hero 區塊。

## 修法（治本，非補丁；未動 K線/AI 面板內部）

`apps/web/app/companies/[symbol]/page.tsx`：
1. 把 `getCompanyKBar(...)` 移出阻塞的 `Promise.allSettled`，改成**先發起、不 await**的
   `kbarPromise`（沿用檔案既有的 `resolveBannerLastCloseDate().catch(...)` 相同模式）。
2. 新增 4 個小型 async Server Component（`KBarChartSection` / `KBarTickSection` /
   `KBarSourceStatusSection` / `KBarStatusCell`），各自 `await` 同一個 `kbarPromise`
   （共用 promise，不重複打 API），分別包在 `<Suspense>` 邊界內，安裝在原本 4 個消費
   kbar 資料的位置：K 線圖容器、逐筆成交面板、資料來源狀態卡、HUD 統計列的「分K狀態」格。
3. `OhlcvCandlestickChart` 的 Suspense `fallback` 直接重用**同一顆元件**、不帶 kbar 相關
   props（該元件這些 props 本來就有預設值 `kbarRows=[]` / `kbarState="EMPTY"`），所以使用者
   立刻看到的就是真實日線 K 線圖（非佔位骨架），分K resolve 後才無縫替換成含分K的版本。
   `TickStreamPanel`／`SourceStatusCard`／HUD 分K狀態格同樣用「同元件+誠實預設值/載入中」
   當 fallback，不新增假資料、不改任何面板元件內部邏輯。
4. 未觸碰 `OhlcvCandlestickChart.tsx` / `TickStreamPanel.tsx` / `SourceStatusCard.tsx` /
   `AiAnalystReportPanel.tsx` 檔案本身——只改變 page.tsx 呼叫它們的時機與方式。

## 驗收數據（本機 production build，`next start` 指向真 prod API，owner session cookie，3 次量測取中位）

Playwright 量測「hero 價格/名稱區塊可見」（`._co-hero-symbol` + `._co-hero-name` visible）：

| Symbol | Run1 | Run2 | Run3 | **中位** |
|---|---|---|---|---|
| 2330 | 3364ms | 2598ms | 2124ms | **2598ms** |
| 4904 | 1993ms | 1947ms | 2721ms* | **1948ms** |
| 3008 | 1889ms | 1878ms | 1934ms | **1889ms** |

（4904 run3 對照後補測為 2721ms，仍在 3s 門檻內；三檔中位數與逐次量測全數 < 3000ms，符合驗收條件）

修復前（同一批 curl 冷啟動時序）等效首屏時間 ≈ company(0.5-0.8s) + ohlcv(0.4-0.5s) +
max(kbar 7.5-8s, 其餘 phase2 ≤1.5s) ≈ **8.5-9.5s**，與 Elva 走查量到的 10.7s 同量級。

`networkidle`（全頁含分K完全 settle）在 kbar 冷啟動時仍會到 4-14s——這是**設計內**：分K本來
就非首屏必要資料，允許它背景慢慢到達，不再阻塞使用者看到價格與 K 線。

## 驗證截圖
- `reports/company_page_perf_20260720/company_2330_early.png`（hero+日線K線立即可見，
  分K狀態格顯示「載入中」誠實過渡態）
- `reports/company_page_perf_20260720/company_2330_settled.png`（全頁 settle 後，分K狀態格
  正確顯示「5,316 根」，逐筆成交明細表格正常填入資料，無版面跳動/破版）

## 盤中不劣化說明
本修法不改變資料抓取的來源或正確性，只改變「何時」把 kbar 結果交給前端；09:00 開盤後 kbar
理論上會更快命中 Redis cache（盤中同一交易日反覆被打），Suspense 拆分只會讓體感更快，不會更慢。
