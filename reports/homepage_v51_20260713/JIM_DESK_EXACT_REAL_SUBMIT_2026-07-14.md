# 交易台 /desk-exact 下單票接真送單（paper 通道）— Jim，2026-07-14 晚

## 範圍
接續 `JIM_DESK_EXACT_DATA_WIRING_2026-07-14.md`（唯讀版）。楊董「後端都接好，唯讀不算數」，
本輪把下單票的「送出」接上真實 paper 送單流程。**紅線：只接 paper 通道，完全不碰真金/KGI
SIM 送單/任何鎖檔檔案**。

## 做了什麼
1. **買賣切換／張股閘門／數量+價格步進器**：從純靜態展示改為真互動（原稿本來就沒有 JS，本輪
   是新增，非「拿掉功能」）。桌面 `.seg2`/`.lotsw`/`.qty-step`/`.step` 與手機 `.m2-side`/
   `.lotsw.big`/`.m2-step` 各自獨立 wiring（`wireTicket("t")` / `wireTicket("m2t")`，共用同一套
   邏輯但各自獨立 DOM 狀態，因為兩份 markup 同時存在於 DOM，只是 CSS media query 切換誰可見）。
2. **預估金額／執行後可用**：即時重算（`qty × unit倍數 × price`；執行後可用 = 已抓到的真實
   `paper/portfolio.availableCashTWD` 減掉本單金額）。**手續費(估)／執行後部位**維持「示意」
   文字——沒有可靠的手續費/稅率官方來源，寧可誠實標「示意」也不猜一個看起來像真的數字。
3. **送出流程**（真呼叫，經 `/api/ui-final-v031/backend?path=` 同源代理）：
   - Step 1：`POST /api/v1/paper/preview`（既有 dry-run 端點）取得真實 `riskCheck.guards`，
     動態渲染進風控預覽面板（取代原本的 4 條靜態「示意」列）。
   - Step 2：`GET /api/v1/uta/accounts` 找 `adapterKey==="paper"` 的帳號 id。
   - Step 3：`POST /api/v1/trading/orders`（統一下單流 D1 既有端點，`orderCreateInputSchema`
     契約）——payload：`{accountId, symbol:"2330", side, type:"limit", quantity, quantity_unit,
     price, orderCond:"cash", session:"regular", timeInForce:"rod"}`。
4. **orderCond/session/timeInForce 定案為固定值**（非新增選擇器）：原稿下單票**只有一個委託
   類型 option（限價）**，沒有零股/融資融券/當沖/session 選擇器 UI——不無中生有加控件（Simplicity
   First + Surgical Changes），固定送「現股 · 整股 · ROD」，這是唯一在此票面上合法且被使用者
   實際選得到的組合。`quantity_unit` **必填無 default**，直接讀張/股切換鈕當下狀態（無 fallback）。
5. **回報**：送出成功／被擋／被 order-rules.ts 矩陣拒絕／連線錯誤四種結果皆映射成人話
   （`unifiedBlockedMessage()`／`ORDER_RULE_REASON_LABELS`，沿用 `final-v031-live.ts`
   既有的同一套碼表與措辭，非自創第二套語意）；成功後呼叫既有 `renderLedger()`/
   `renderCapital()` 重抓，今日委託表與資金摘要即時更新，不整頁重整。
6. **KGI SIM 送單／實盤通道**：完全未呼叫、未新增 UI；「實盤通道 停用」文案維持原樣。

## 🔴 真實驗收結果（誠實揭露，非假綠）
測試執行於台北時間 **14:39**（盤後——台股常規盤 09:00–13:30 已收盤）。真瀏覽器點擊「送出」後：
- 真的打到後端 `POST /api/v1/trading/orders`，回傳 **HTTP 422**
- Body：`riskCheck.decision:"block"`，`guards:[{guard:"trading_hours", decision:"block",
  message:"Current time is outside allowed trading hours (09:00-13:30 Asia/Taipei)."}, ...]`
- UI 正確顯示人類語言「**未通過：交易時段**」（非裸 enum「trading_hours」）

這是**真實風控引擎的合法攔截**（trading_hours guard，非本頁 bug、非 stub）——證明整條送單
管線真的打穿到後端風控層，只是剛好卡在收盤後這個誠實的業務規則上。**沒有繞過或暫解任何風控/
W6 gate**（`不能碰的區域`鐵律，本輪完全沒有觸碰 risk-engine/execution-mode/trading-service 等
鎖檔）。若要驗證「盤中送出後今日委託表真的多一筆已受理」，需在下一個交易日 09:00–13:30
Taipei 內重跑同一顆 Playwright spec（無需改測試碼，已寫好雙分支斷言：`201`=驗證新單出現在
`ledger-rows`／`422`=驗證封鎖訊息人話化，兩者皆視為「送單管線正確」的證據）。

## 修改檔案清單
- `apps/web/public/desk-exact/index.html`（新增 ticket-controller 段落：`wireTicket()`、
  `renderRiskGuards()`、`unifiedBlockedMessage()`、guard/order-rule 中文碼表；desktop+mobile
  票面 HTML 加 `data-slot`／`data-side`／`data-unit`／`data-act` hook；送出鍵移除
  `disabled`；`apiFetch()` 擴充支援 POST + body）
- `packages/qa-playwright/tests/jim_desk_exact_preview_20260714.spec.ts`（既有 3 條測試的
  submit-disabled 斷言改為「預設應可互動」；新增第 5 條真送單測試，雙分支斷言
  201/422 皆視為管線正確，422 額外驗證訊息非裸 enum）

## 驗證
- `pnpm typecheck`：15/15 綠。
- `pnpm --filter @iuf-trading-room/web test`：680/680 綠（零回歸；本輪未改任何 `apps/web`
  vitest 案例，只動靜態頁與 qa-playwright spec）。
- `pnpm run build:web`：全綠。
- 真瀏覽器（本機 `next start` 打 prod API + railway CLI 取得 SEED_OWNER）：
  `jim_desk_exact_preview_20260714.spec.ts` **5/5 desktop-chromium PASS**（含新增真送單
  測試）。截圖 `reports/qa_playwright_20260714_064110/desk-exact-desktop-submit-outcome_
  desktop-chromium.png` 可見：張/股切換到「股」、數量 1、委託價 1000、預估金額即時算出
  「1,000元」、執行後可用即時算出「9,998,987」、風控預覽面板顯示真實 guard（交易時段/報價
  過舊）、送出鍵文案跟著即時更新「送出模擬單 · 買進 1 股」、底部訊息顯示「未通過：交易時段」。

## 已知簡化（誠實揭露）
- 手續費(估)／執行後部位：無官方費率/稅率來源，維持「示意」文字而非猜測數字。
- orderCond/session 固定「現股/整股」：原稿票面只有限價一個選項，沒有零股/融資融券/當沖/
  session 選擇器 UI，未無中生有新增控件（若要支援完整矩陣，需另外設計 UI，屬下一輪範圍）。
- 桌面/手機兩份票面各自獨立狀態（非同步）：兩份 DOM 同時存在，只有一份依斷點可見，各自送單
  互不影響，但若使用者刻意在兩個斷點下修改後切換視窗寬度，兩邊數字不會同步——原稿本來就是
  兩份獨立版面（非 responsive 同一份 DOM），符合既有設計慣例。

## 下一步
1. 下一個交易日 09:00–13:30 Taipei 內重跑 `jim_desk_exact_preview_20260714.spec.ts` 第 5 條，
   確認 201 分支（今日委託表真的出現已受理新單）。
2. Elva 驗收通過後裁決是否切換正式交易室 route。
