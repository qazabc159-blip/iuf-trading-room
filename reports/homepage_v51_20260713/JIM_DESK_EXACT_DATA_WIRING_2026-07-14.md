# 交易台「原封搬原稿」/desk-exact 資料接線報告（Jim，2026-07-14）

## 範圍
原稿：`reports/homepage_v51_20260713/trading_desk_artifact_source.html`（82,465 bytes，
artifact `edc74151`「交易台版面重設計 mock v2」逐字原稿，桌面 1280×760「基準鎖定」＋手機
390×760「全新設計單流下單台」兩套版面）。比照 home-exact 已驗證方法論：byte-exact 搬
`<style>` 與兩套版面本體，剝掉 artifact 展示框（`.doc-head`/`.stage`/`.dev`/`.dev-cap`/
`.dev-manifesto`/`.bezel` 展示標註——此原稿沒有 `.foldline` 摺線標註，跳過），加最小
`data-slot` hook + 頁尾 inline `<script>` 換真資料，**版面／CSS／class／結構逐字保留**。
新增 `/desk-exact` 隔離預覽路由，**完全未動現有交易室 route**。

## 對派工訊息的一項偏離（判斷揭露）
派工訊息建議 override 抄「`.device{height:auto}`／`.scroll{overflow visible}`」，但此原稿
用的容器類別是 `.screen.desk`/`.screen.mob`（非 `.device`/`.scroll`），且桌面版
`.desk-cockpit{grid-template-rows:34px 1fr}` 是靠 CSS Grid 固定列高撐滿「一屏全部看到」的
終端密度設計（非可捲動文件流）——`height:auto` 會讓 `1fr` 列塌成 0、整個版面垮掉。改用
`.screen.desk{width:100%!important;height:100dvh!important}`（`.screen.mob` 同），保留原稿
「一屏全數可見」的密度設計意圖，同時滿足「全寬撐滿、禁 1280 置中」的楊董退件教訓。已用
真瀏覽器在 1920 寬驗證：`.screen.desk` 實測寬度 1920px（見驗證段）。

## Token → 端點對照表
所有呼叫皆走既有 `/api/ui-final-v031/backend?path=...` 同源代理（帶 cookie），**零新增
allowlist 規則**——所需端點全部已由先前 PR（下單矩陣 #1250/#1252、KGI SIM、統一下單流 D3
`/uta/orders`、paper trading room）加入 `GET_ALLOWLIST`：

| 區塊 | 欄位 | 端點 | Fallback / 誠實狀態 |
|---|---|---|---|
| 帳戶/安全條 | 券商連線狀態徽章 | `GET /api/v1/kgi/status` | `quote_connected && trade_connected` → 已連線；其一 → 部分連線；皆否 → 未連線（收盤後 gateway 停機屬正常，非 bug——EC2 gateway 平日 08:20 開/14:10 關排程，見 memory） |
| 症狀頭（symhead, 2330） | 現價/漲跌/漲跌%/開高低昨收/量 | `GET /api/v1/kgi/quote/ticks?symbol=2330&limit=1` | 取最後一筆 tick；無 tick（gateway 離線）→ 誠實顯示「尚無報價」，不假造 |
| 五檔盤口（2330） | 委買委賣 5 檔價/量、價差、委買委賣總量 | `GET /api/v1/kgi/quote/bidask?symbol=2330` | 索引 0=最佳檔（沿用 `BidAskPanel.tsx` 既有消費慣例：`bestAsk=ask_prices[0]`）；無資料 → 誠實「尚無委買委賣」+「系統持續輪詢中，非系統故障」（沿用 `BidAskPanel.tsx` 既有措辭風格） |
| 外盤/內盤比 | 桌面+手機 | — | **刻意不接**：真內外盤比需要成交明細掛單方向（買賣盤口成交分類），五檔委買委賣量不是同一件事，用委買委賣量比例冒充會誤導，誠實顯示「示意」/「--」 |
| 自選清單（10 檔） | 每檔即時價/漲跌% | `GET /api/v1/kgi/quote/ticks?symbol=<S>&limit=1`（10 檔平行呼叫） | 股名維持原稿真實公司名（非 API 抓取，但都是真實代碼對應真實公司，非杜撰）；無 tick → 誠實「--」 |
| 資金摘要 | 模擬本金/可用資金/持倉市值/總損益 | `GET /api/v1/paper/portfolio` | `summary.baseCapitalTWD`/`availableCashTWD`（缺→ `baseCapital-investedCost` 回退，沿用 `paper-orders-api.ts` 既有註解的官方回退公式）/持倉市值=`investedCostTWD+unrealizedPnlTwd`（無 unrealized → 「缺價未估」而非當 0）/總損益=`realizedPnlTwd+unrealizedPnlTwd`；動用資金分母行文照抄產品鐵律原文「動用資金 X 為報酬分母 · 缺價部位另標不計 0」 |
| 委託回報（今日委託 tab） | 時間/代碼/方向/數量/委託價/已成交/狀態/單號 | `GET /api/v1/uta/orders?limit=5` | 狀態文案沿用 `unifiedOrderStatusLabel()` 的既定映射（`lib/paper-orders-api.ts`，六態）；名稱欄無公司名來源，誠實顯示代碼本身（非杜撰假名）；單號顯示 `id` 末 8 碼 |
| 其他分頁計數 | 成交紀錄/KGI 讀取 | `GET /api/v1/paper/fills`、`GET /api/v1/portfolio/kgi/positions` | 純計數（陣列長度），分頁本身無點擊互動（原稿本來就沒有分頁切換 JS，見下段） |
| K 線圖 + MACD 副圖 | — | — | **維持原稿靜態示意**（原稿本身已標「示意 K 線」）；真 K 棒序列渲染超出本輪範圍，誠實不做，不接假資料冒充 |
| 風控預覽面板 | 4 項 riskCheck | — | **維持原稿靜態示意**，標頭改「示意」——面板依賴一筆假設中的待送出委託，本頁未做互動下單流，接不上即時風控引擎 |
| 下單票／下單塢 | 買賣切換/張股閘門/價格步進器 | — | 維持原稿靜態展示（原稿本來就是純 CSS 示意，從未掛過 JS 互動，本輪未新增任何互動） |

## 🔴 下單紅線處置（本輪最重要決策，請 Elva 裁）
原稿「送出模擬單」按鈕文案暗示真會送出（「一鍵送出，無確認視窗」）。**本輪判斷：不接真送單**
——改為：
1. `<button class="submit">`／`<button class="m2-submit">` 加 `disabled aria-disabled="true"`。
2. 文案改為「唯讀預覽 · 尚未接上送單」／副標「下單流待另行實作」，拿掉原稿暗示會真送出的文字。
3. `oneclick` 說明列改「本頁為版面預覽 暫不接受送出 · 送單流程待實作後另行開通」。
4. 新增 iso-override CSS：`.submit:disabled,.m2-submit:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.4)}`
   視覺上明顯區隔於可互動按鈕。
5. 買賣切換鈕／張股閘門／價格 +− 步進器**維持原稿無 JS 靜態展示**（原稿本身從未掛過任何互動
   邏輯，這不是我拿掉互動，是原稿本來就是純 CSS mock）。

真金/paper 送單 API（`/api/v1/paper/preview|submit`、`/api/v1/kgi/sim/order`、
`/api/v1/trading/orders`）完全未呼叫；`quantity_unit`/orderCond/session 等契約欄位本頁不涉及
（因為沒有送單）。若 Elva 判斷需要接上唯讀 preview（試算但不送出）或完整可送出下單流，屬於
下一輪 T-2/T-4 等既定 backlog 範圍，非本輪擅自決定。

## 修改檔案清單
- `apps/web/public/desk-exact/index.html`（新增，1,238 行；CSS 逐字保留可 diff 驗證見下方
  驗證段；桌面/手機標記 `data-slot` + 隔離 override + inline hydration script）
- `apps/web/app/desk-exact/page.tsx`（新增，`/desk-exact` 全屏預覽路由，仿 `/home-exact`
  wrapper，scope class 換 `.iuf-desk-exact-fullscreen-frame`，`components/FinalOnlyFrame.tsx`
  完全未動）
- `packages/qa-playwright/tests/jim_desk_exact_preview_20260714.spec.ts`（新增，本輪驗收
  harness：1280/1920/390 三寬度）
- `apps/web/app/api/ui-final-v031/backend/route.ts`：**零改動**——所有端點已在既有
  allowlist 內

## 驗證
- `pnpm typecheck`：15/15 綠（web + qa-playwright 皆過）。
- `pnpm --filter @iuf-trading-room/web test`：680/680 綠（零回歸、零新增測試改動既有案例；
  本輪未新增/修改任何 `apps/web` 的 vitest 案例）。
- `pnpm run build:web`：全綠，新增 `/desk-exact` route（`ƒ /desk-exact 218 B 102 kB`）。
- 真瀏覽器（本機 `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com next start` + railway CLI
  取得的 `SEED_OWNER_EMAIL/PASSWORD`，沿用既有 `auth.setup.ts` 機制）：
  `jim_desk_exact_preview_20260714.spec.ts` 4/4 desktop-chromium PASS：
  - **1280**：`sym-price`（gateway 收盤後離線，誠實顯示 `--`，非 bug——直接 curl 驗證
    `/api/v1/kgi/status` 回 `quote_connected:false`，符合 EC2 gateway 14:10 關機排程）、
    `gw-state`＝「未連線」、`cap-base`＝「10,000,000」、`cap-avail`＝「9,999,987」（**真實
    paper portfolio 數字**）、`ledger-count-orders`＝「2」（**真實 uta orders 筆數**）、
    submit 按鈕 `disabled===true`；`scrollWidth===clientWidth`（零水平溢出）；零非預期
    console/network 錯誤（扣除已知 `/auth/me`＋`market-data/overview` local-dev-against-
    prod-API harness 噪音，`jim_memory.md` 已記錄）。
  - **1920**：`scrollWidth===clientWidth`；`.screen.desk` 實測寬度 1920px（撐滿全寬，非
    1280 置中黑邊）。
  - **390**：mobile submit 按鈕 `disabled===true`；`scrollWidth===clientWidth`。
  - 截圖：`reports/qa_playwright_20260714_062142/desk-exact-{desktop-1280,desktop-1920,
    mobile-390}_desktop-chromium.png`（肉眼確認：桌面/手機版面結構與原稿逐字 CSS 一致、
    K 線示意帶正確顯示、資金摘要/委託回報真資料已注入、送單鍵灰化＋誠實文案）。
  - CSS byte-exact 驗證：`diff` 抽出檔案 `<style>` 區塊（437 行）與原稿逐字比對，**完全
    相同（zero diff）**。

## 已知簡化（誠實揭露，非隱藏）
- 內外盤比：五檔委買委賣量不是真內外盤（需要成交明細掛單方向），本輪誠實顯示「示意」/
  「--」，未用委買委賣量比例冒充。
- 委託回報「名稱」欄：無公司名對照來源，顯示代碼本身而非杜撰公司名。
- K 線 + MACD 副圖：維持原稿靜態示意（原稿本身已標「示意 K 線」），真 K 棒渲染超出本輪範圍。
- 風控預覽面板：維持原稿靜態示意（標頭改「示意」），未接風控引擎即時判定——面板依賴一筆
  假設中的待送出委託，本頁未做互動下單流。
- 「執行事件 / 風控」分頁計數（原稿寫死「6」）：無對應端點，維持原值未更新，唯一未接真資料
  的計數欄位。
- 下單票／下單塢的張股閘門、買賣切換、價格步進器：維持原稿純 CSS 靜態展示（原稿從未掛過 JS
  互動，非本輪拿掉功能）。

## 下一步建議（給 Elva）
1. 拿 `/desk-exact` 跟原稿 artifact `edc74151` 疊圖驗美術（截圖已備妥，見驗證段路徑）。
2. 裁決下單紅線處置是否符合預期（唯讀 disabled + 誠實文案），若要往前推進到「可試算但不
   送出」或「完整可送出」，屬於下一輪 T-2/T-4 backlog，需另行明確授權範圍。
