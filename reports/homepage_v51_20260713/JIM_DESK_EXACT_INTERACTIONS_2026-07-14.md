# 交易台互動接活 — 真 K 線 + 切標的 + query prefill + 分頁真切換（Jim，2026-07-14 深夜）

## 背景
楊董退件：「交易台也沒真的做好」。診斷：K 線是原稿假示意圖、自選清單點了不切標的、分頁互動死
——數據面板有真值但操作是死的。本輪把交易台從「有資料的展示牆」補成「真的能操作」。

## 任務 1：K 線接真資料（最高優先）
- 端點：`GET /api/v1/companies/<symbol>/ohlcv?interval=1d|1w`（同源代理，`/api/v1/companies`
  前綴早已在 `GET_ALLOWLIST`，**零 allowlist 改動**）。symbol 直接當路徑參數（比照
  `OhlcvCandlestickChart.tsx` 既有消費慣例，不需先解析成公司 UUID）。
- **凡 `bar.source==="mock"` 一律過濾掉**，絕不混進真線裡（同
  `OhlcvCandlestickChart.tsx` 的 `officialDailyBarCount()` 原則）。真查證：2330 的
  `interval=1d` 回 2463 筆，全部 `source:"tej"`（真實 TEJ 資料，2016-06-04 至今），無一筆
  mock。
- 桌面／手機主圖改用真 candlestick（SVG 動態產生，紅漲綠跌、amber MA20 線）；MACD 副圖
  真算 EMA12/26/9（純數學，`computeEMA`/`computeMacd`），少於 35 筆資料時誠實顯示「資料
  筆數不足以計算 MACD」而非硬算假指標。
- **目標/建倉/停損三條虛線直接拿掉**——那是 S1 策略價位，一般自選股（2454/2382 等）沒有
  對應真實來源，不讓假線混進真 K 線。
- interval：日/週接真（`1d`/`1w`，contracts `OhlcvInterval` 只定義這兩個 + `1m`=月非分鐘）；
  1分/5分/15分**沒有任何可驗證來源**（不是「懶得接」，是 contract 層面根本沒有分鐘粒度），
  三顆按鈕改 `disabled` + title 說明，不是點了才失敗——一開始就誠實停用。
- BOLL/KD/量 副圖切換：沒有真實計算來源，同樣 `disabled`；MA20/MACD 兩個「有真資料」的
  指標保留切換互動（顯示/隱藏已繪製的線，非重算）。

## 任務 2：互動接活
1. **自選清單點擊切標的**：`switchSymbol()` 全域重灌症狀頭/五檔盤口/K 線/下單票標的欄，
   watchlist "on" 高亮跟著移動。真瀏覽器驗證點 2454 後：symbol header→"2454 聯發科"、
   depth-meta→"2454 · ..."、下單票標的欄→"2454　聯發科"、K 線重繪聯發科真實走勢。
2. **query prefill**：`/desk-exact?symbol=X&side=buy`。**發現並修復一個轉發缺口**——
   `apps/web/app/desk-exact/page.tsx` 原本把 iframe src 寫死成
   `/desk-exact/index.html?rev=...`，外層 Next.js 頁面的 `symbol`/`side` query 從未被轉發進
   iframe，頁內 script 的 `applyQueryPrefill()` 永遠讀不到（就算頁內邏輯完全正確也沒用）。
   比照既有 `apps/web/app/final-v031/portfolio/page.tsx` 讀 `searchParams` 轉發進 iframe src
   的模式，補上等價的 sanitizer（`safeTicker`/`safeSide`，正規表示式驗證，不接受任意字串）。
3. **分頁切換**（今日委託/成交紀錄/模擬庫存/KGI 讀取/執行事件）：真點擊真切換，各分頁對應
   真端點（`uta/orders`／`paper/fills`／`paper/portfolio`／`portfolio/kgi/positions`）；
   「執行事件/風控」無對應端點，誠實顯示「此分頁尚未接上執行事件／風控紀錄端點」而非假造
   數字（原稿寫死的「6」已拔除，計數改「--」）。
4. **自選搜尋框**：輸入即時 filter 現有清單（代碼/名稱比對），Enter 跳轉到第一筆符合結果。

## 🔴 一個真實踩坑（誠實記錄，非隱藏）
Query prefill 修好後第一輪本機驗證持續失敗（iframe src 死活不帶 query），一路查到懷疑
Next.js middleware rewrite——最後發現是**我自己重啟本機 next start 時，`pkill -f "next
start -p 3100"` 在這個 Windows/git-bash 環境沒有真的殺掉舊行程**，所以每次「rebuild 後測試」
其實都打在舊的、沒有修復的伺服器上。改用 `netstat` 找 PID 再 `taskkill //F //PID` 才真正
重啟成功，之後 query prefill 一次就對。技術細節記在 per-agent memory。

## 修改檔案清單
- `apps/web/public/desk-exact/index.html`（K 線真資料渲染函式群、`switchSymbol()`／
  `applySymbolIdentity()`、watchlist 點擊+搜尋、ledger 5 分頁真切換、query prefill 讀取；
  拿掉目標/建倉/停損假線；1分/5分/15分/BOLL/量/KD 標 `disabled`）
- `apps/web/app/desk-exact/page.tsx`（讀 `searchParams` 轉發 `symbol`/`side` 進 iframe src）
- `packages/qa-playwright/tests/jim_desk_exact_preview_20260714.spec.ts`（1920 寬度斷言更新
  為 1520 置中設計；新增 4 條互動驗收：真 K 線／symbol 切換／query prefill／分頁切換）

## 驗證
- `pnpm typecheck`：15/15 綠。
- `pnpm --filter @iuf-trading-room/web test`：680/680 綠（零回歸，本輪未改任何 vitest 案例）。
- `pnpm run build:web`：全綠。
- 真瀏覽器 Playwright（本機 `next start` 打 prod API + railway CLI 取得 SEED_OWNER）：
  **9/9 desktop-chromium PASS**，含 4 條新互動測試：
  - K 線：`chart-status`＝「90 筆真實 日K · 至 2026-07-14」、90 個真 candle `<rect>`
    （舊假圖只有寫死 16 根）、MACD 顯示真讀數「DIF 33.19 · MACD 40.50 · OSC -7.31」、
    圖上不再出現「目標」字樣。
  - symbol 切換：點 2454 後 symbol-code/name/depth-meta/ticket-label/watchlist 高亮/
    chart-status 全部確認切換為 2454。
  - query prefill：`?symbol=2382&side=sell` 進來後 symbol-code=2382、sell 按鈕 on、buy 按鈕
    off。
  - 分頁切換：成交紀錄 tab 的 `<thead>` 內容確認不同於今日委託 tab。
  - 截圖：`reports/qa_playwright_20260714_073718/`（肉眼確認：真實 2330／2454 K 線走勢、
    紅漲綠跌、amber MA20 線、MACD 真副圖、下單票標的欄跟著切換）。

## 已知簡化（誠實揭露）
- BOLL/KD/量副圖：無真實計算來源，維持 disabled（非做了假的）。
- 1分/5分/15分：contract 層根本沒有分鐘粒度資料源，非本輪省略。
- 執行事件/風控分頁：無對應後端端點，誠實顯示未接上，而非沿用原稿假「6」筆。
- 自選搜尋框 Enter 跳轉只挑「目前可見清單中第一筆」，不做任意代碼的全市場查找（原稿清單
  本身就是固定 10 檔）。

## 下一步
1. Elva 驗收本輪三項（K 線真資料/symbol 切換/query prefill+分頁切換）。
2. 若通過，連同前一輪（真送單）一起裁決是否切換正式交易室 route。
