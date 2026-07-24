# #1348 前端誠實透傳 — 市場情報法人面板（Jim-2, 2026-07-24）

## 缺口回顧
後端 `/api/v1/market/institutional-summary/finmind` 早已回 `state`("live"/"stale")、
`isFallback`、`dataDate` 三欄（Bruce 2026-07-24 09:5x 盤中實測 PASS，數值對 FinMind
交叉驗證分毫不差，見 `evidence/sprint_2026_07_23/BRUCE_PROD_VERIFY_5MERGE_20260723.md`
§11）。但前端 `market-intel-data.ts` 的 `resolveInstitutional()` 從未透傳這三欄，
真正渲染的 `app/final-v031/market-intel/page.tsx` 標題寫死「三大法人 · 今日買賣超」，
不論資料新舊都這樣顯示——盤中把昨日法人資料無標示當「今日」展示。

## 修法
- `apps/web/lib/api.ts` — `MarketInstitutionalSummary` 型別補 `dataDate`/`isFallback`
  （對齊 apps/api 已回傳的真實 shape，型別新增不動 apps/api）。
- `apps/web/app/market-intel/market-intel-data.ts` — `MarketIntelInstitutional` 型別
  補 `state`/`dataDate`，`resolveInstitutional()` 透傳這兩欄；新增純函式
  `institutionalTitleLabel()`（live → 「三大法人 · 今日買賣超」；stale/fallback 且有
  `dataDate` → 「三大法人 · MM/DD 收盤」，複用既有 `lib/data-state-copy.ts::formatAsOfDate()`
  同款「MM/DD 收盤」詞彙，不是自造新格式；無日期時退回「三大法人 · 買賣超（非即時）」）。
- `apps/web/app/final-v031/market-intel/page.tsx` — `InstitutionalPanel` 改用
  `institutionalTitleLabel()`；非 live 態加一枚 `_mi-badge warn`「非即時」克制標記
  （複用既有 badge 樣式，未新增 CSS）。live 態渲染結果與修改前逐字元相同，回歸為零。

## 驗收
1. **單元測試釘住**（`apps/web/app/market-intel/market-intel-data.test.ts`，新增 5 個
   test，全部綠）：
   - `resolveInstitutional` live/`stale` 兩態各自透傳 `state`/`dataDate`
     （拿掉透傳這兩行程式碼，這兩個 assertion 會紅）。
   - `institutionalTitleLabel`：live 態含「今日」字樣＋逐字相等舊標題；stale 態＝
     `三大法人 · 07/23 收盤`；state 非 live 且無 dataDate → 非即時退回文案。
2. `pnpm --filter @iuf-trading-room/web typecheck` — 綠（tsc -p tsconfig.json --noEmit
   無輸出）。
3. `pnpm --filter @iuf-trading-room/web` 全量 vitest — **92 test files / 808 tests
   全綠**（含新增 5 個）。
4. `pnpm run build:web`（含 `build:packages`）— 綠，`/final-v031/market-intel`
   route 正常編譯（2.2 kB）。
5. **本機對真 prod API 端到端驗證**（現在正是盤中 fallback 窗）：`next dev -p 3500`
   （`NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`）+ owner session login
   （`qazabc159@gmail.com`）+ Playwright headless Chromium 打
   `http://localhost:3500/final-v031/market-intel`（SSR 端把瀏覽器帶來的
   `iuf_session` cookie 轉發給 prod API，走既有 `requestRaw()` SSR cookie 轉發機制，
   非 mock）：
   ```
   INSTITUTIONAL
   三大法人 · 07/23 收盤
   非即時
   外資  買 26.39 億 · 賣 24.91 億   +1.48
   投信  買 1.42 億 · 賣 1.02 億     +0.40
   自營商 買 22.64 億 · 賣 23.24 億  -0.60
   ```
   數值與 Bruce 昨日 09:5x 記錄的真值（26.39億/24.91億/+1.48 等）逐位元組相同，
   證實走的是同一批真資料，只是這次標題誠實標了「07/23 收盤」+「非即時」，不再
   偽稱「今日買賣超」。0 pageerror。截圖：
   `evidence/sprint_2026_07_24/JIM2_1348_INSTITUTIONAL_HONESTY_LOCAL_VERIFY_20260724.png`

## 禁區確認
- `apps/api/*` 零改動（只在 `apps/web/lib/api.ts` 補前端消費型別，型別新增描述
  後端「已經在回」的真實欄位，非新增後端行為）。
- 其他頁面零改動；`apps/web/app/market-intel/page.tsx`（非真渲染的孤兒 route）
  未動。

## 附註
- 盤後態（今晚 FinMind 發布今日值後）：`state` 會自然轉 `"live"`，
  `institutionalTitleLabel()` 走 live 分支顯回「今日買賣超」，不用另外處理——
  沒有額外的日夜分支邏輯，純粹跟著後端 state 走。
- 附帶效果：`institutions:[]`（`state:"unavailable"`，例如 FinMind token 缺失）情境
  下，標題也會從恆顯「今日買賣超」改成「三大法人 · 買賣超（非即時）」——這是同一條
  誠實規則的自然延伸，非額外功能，內容區塊本身（`--`/「同步中」）行為不變。
