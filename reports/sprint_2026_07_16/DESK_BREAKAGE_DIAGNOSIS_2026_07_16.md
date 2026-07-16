# 交易台壞況診斷 — 2026-07-16（四）10:1x TST（Bruce-3, owner session, prod, read-only）

## 任務
楊董反饋「交易台還是壞的」，無具體症狀。用 owner session 打 prod 正式交易室 route（`/portfolio`，非 `/desk-exact` 預覽），
列出所有看得見的壞況，按嚴重度排序。診斷任務，未動任何代碼、未送任何下單。

## 結論（按嚴重度）

1. 🔴 **主要報價區塊 + 整個自選清單（10 檔）全部顯示「尚無報價」/`--`，跟 3 公分外的五檔盤口/K 線同頁矛盾**
   — 根因＝`renderSymbolHeader()`／`renderWatchlist()` 只呼叫 `/api/v1/kgi/quote/ticks`（KGI 原生 tick buffer，
   因 on_tick 零觸發長期是空的，實測回 `{"error":"QUOTE_NOT_AVAILABLE"}`），**沒有 fallback 到 twse_mis**；
   而五檔盤口呼叫的是 `/api/v1/kgi/quote/bidask`，這支端點**內建 twse_mis fallback**（實測
   `"source":"twse_mis_intraday"` 有真資料）。兩支端點 fallback 策略不一致，導致頁面左上角報價空白、
   右邊盤口卻是活的——這應該就是楊董說「壞」的第一眼症狀。
2. 🟡 **下單票預設委託價寫死 `1085.00`，跟目前選中標的/市價完全無關**（2330 現價 ~2,420），且該值直接
   餵入「預估金額」計算（1085×2000股=2,170,000元，跟截圖數字吻合）。使用者若沒注意調整就送單，會送出
   價格離譜的限價單（雖限價不會成交，不會真的虧錢，但誤導性強、體感像「壞了」）。
3. 🟡 **「今日委託」清單標籤與實際資料不符** — 呼叫的是 `/api/v1/uta/orders?limit=5`（純取最新 5 筆，
   不分日期），畫面上混雜了 7/15 12:38-12:39 的舊單跟 7/16 10:09-10:10 的今日單，標「今日」但沒有日期
   過濾邏輯。
4. 💭 route/middleware 正常：正式 `/portfolio` 仍正確 rewrite 到 desk-exact 定版引擎（`FINAL_V031_ROUTE_REWRITES`
   沒有復發，跟 direct `/desk-exact/index.html` 內容逐字一致），非本次「壞」的根因，#1281 修復未退化。
5. 💭 手機 390 版：同一引擎回應式正常渲染，跟桌機同款報價 bug（非手機獨有問題）。
6. 💭 大盤真值對照：TWSE 官方 MIS `z:45090.16`（10:13:40 TST），跟楊董提到的 ~45089 一致，屬真值非 bug；
   desk-exact 頁面本身聚焦個股不含大盤指數面板，無對照可驗。
7. 💭 console 401×3（`/auth/me`）+ 多筆 `ERR_ABORTED` 屬 Next.js RSC prefetch 被導頁中斷的正常雜訊
   （其餘頁面渲染、送單、K 線皆正常），非功能性錯誤，不列入壞況。

## 證據

### 截圖
- 桌機 1920×1080：`C:\Users\User\AppData\Local\Temp\claude\C--Users-User\0c6b807e-1c05-4738-8a22-c4dd496052d3\scratchpad\desk_diag_20260716\desktop_portfolio.png`
  （肉眼可見：header「2330 台灣積體電路製造」旁「尚無報價」／價格 `--`／`-- --`／`--%`；左側自選清單
  10 檔全 `---`；同畫面右側五檔盤口有真數字 2,445.00/2,440.00/.../2,420.00；下單票委託價 `1085.00`）
- 手機 390×844：`...\desk_diag_20260716\mobile_portfolio.png`（同款報價空白 bug）
- `/desk-exact` 直連對照：`...\desk_diag_20260716\desktop_desk-exact-direct.png`（跟 `/portfolio` 內文字
  逐字相同，證明非 middleware rewrite 問題）
- 完整結構化證據（含 iframe innerText、console errors、failed requests）：
  `...\desk_diag_20260716\results.json`

### 端點回應關鍵行
```
GET /api/v1/kgi/quote/ticks?symbol=2330&limit=1
  -> {"error":"QUOTE_NOT_AVAILABLE","message":"No quote data for 'getRecentTicks(2330)' (code=)."}

GET /api/v1/kgi/quote/bidask?symbol=2330
  -> {"data":{"symbol":"2330", ..., "bid_prices":[2420,2415,2410,2405,2400],
       "ask_prices":[2425,2430,2435,2440,2445], "source":"twse_mis_intraday",
       "time":"10:16:05","tradeDate":"20260716"}}

GET /api/v1/kgi/status
  -> raw_quote_connected:true, raw_trade_connected:false,
     last_quote_time:"2026-07-16T01:06:58.222Z"（>1hr 前，交易腿沒真的在收 tick）

GET /api/v1/market-data/effective-quotes?symbols=2330,6226
  -> 2330 selectedSource:"twse_mis", last:2420, fresh, ageMs:22079（這支端點是健康的，
     desk-exact 前端沒用它餵報價 header/watchlist）

GET /api/v1/uta/orders?limit=5
  -> 混雜 fillTime "2026-07-15T04:39:15Z"（顯示為「12:39:15」今日委託）跟
     "2026-07-16T02:10:27Z"（今日真實成交），純取最新 5 筆非日期過濾
```

### 原始碼比對（`origin/main` HEAD `1ee6f028`，跟 prod `buildCommit` 一致）
- `apps/web/app/final-v031/portfolio/page.tsx`：`/portfolio` 用 `FinalOnlyFrame` iframe 指向
  `apps/web/public/desk-exact/index.html`（#1281 定版引擎），middleware rewrite 鏈正常。
- `apps/web/public/desk-exact/index.html`
  - `renderSymbolHeader()`（L923-956）／`renderWatchlist()`（L1021-1039）：只呼叫
    `/api/v1/kgi/quote/ticks`，無 fallback。
  - `renderDepth()`（L959+）：呼叫 `/api/v1/kgi/quote/bidask`，該端點自帶 fallback。
  - `renderOrdersTab()`（L1188+）：呼叫 `/api/v1/uta/orders?limit=5`，label「今日委託」但無日期過濾。
  - 委託價 input `data-slot="t-price"` 靜態 `value="1085.00"`（L648），全檔搜尋找不到任何 JS
    會依當前標的/報價動態改寫這個初始值。

## 部署狀態
prod API `/health`：`buildCommit:1ee6f0281134e4d10c64dd8dbc2b83af4a62e746`（= `origin/main` HEAD，
deploy 於 2026-07-15T14:02 TST），無需部署即可驗證，本輪純讀取。

## 建議由誰修
- 🔴 項（1）：backend market-data/KGI 腿 owner（Jason lane）— 統一 `/kgi/quote/ticks` 跟
  `/kgi/quote/bidask` 的 fallback 策略（讓 ticks 端點也吃 twse_mis，或前端改成呼叫已經健康的
  `/market-data/effective-quotes`）；兩條路徑哪個對，建議 Elva 裁決後指派，Bruce 不越權碰
  `market-data.ts`/前端 artifact。
- 🟡 項（2）（3）：前端 `desk-exact/index.html`（Jim/Codex lane）— 委託價預設值改為依當前報價動態
  seed；「今日委託」改真的按日期過濾或改標籤措辭。

## 是否可 deploy / 是否可宣告收口
- 不涉及本輪 deploy（純診斷，未改代碼）。
- **不可宣告收口**：🔴 項是使用者一眼可見、跨自選清單全面性的報價斷線，是「交易台還是壞的」最可能的
  對應症狀，需先修復並經 Bruce 複驗 PASS 才能收。

---

## TLS 修復後複驗 — 2026-07-16 10:39-10:40 TST（同日追加，Bruce-3, owner session, prod, 唯讀）

**背景**：Elva 轉達 Jason 已修 EC2 TLS 憑證鏈（NSSM env 加 `WEBSOCKET_CLIENT_CA_BUNDLE` 指 certifi，
服務已重啟），EC2 本機 `Quote.log` 已見 `Websocket connected`，tick buffer 0→200 持續刷新。要求用同一
套 owner session 手法補驗 prod 端到端迴路是否也活了。

### 結論：**FAIL — EC2 端可能已連通，但截至驗證當下 prod API 端到端迴路仍是斷的，前端仍原樣壞**

1. **`GET /kgi/quote/ticks?symbol=2330`**：FAIL — 兩次探測（10:39:29、10:40:27 UTC，間隔 ~58s，
   中間夾了一輪 Playwright 完整登入+截圖流程，非緊貼硬 sleep）**回應逐字相同**，皆為
   `{"error":"QUOTE_NOT_AVAILABLE","message":"No quote data for 'getRecentTicks(2330)' (code=)."}`，
   跟上午診斷時完全一樣，沒有任何真 tick 資料，非「有資料但沒更新」，是「完全沒有資料」。
2. **`/kgi/quote/bidask` 與 `/kgi/status`**：FAIL（仍未切回 KGI 原生源）——
   - `bidask` 兩次探測 `"source":"twse_mis_intraday"` 不變（10:39:20→10:40:05 只有量微變，價不變，
     twse_mis 特徵），未見任何 `"source":"kgi"` 出現。
   - `kgi/status` 的 `last_quote_time` 兩次探測**完全相同**：`"2026-07-16T01:06:58.222Z"`（跟上午
     10:1x 診斷時同一個值，代表 prod 這一側認知的「最後收到 KGI quote」時間已凍結超過 1.5 小時未動）；
     `raw_trade_connected` 仍 `false`；`raw_quote_connected:true` 仍是上午已定性的**誤導性殘留旗標**
     （跟 `last_quote_time` 凍結矛盾）。
   - `/kgi/quote/subscription-status`：`slotsUsed:21/40`（跟上午一致，無互撞跡象）；2330 所在的
     `slots[]` 項目 `"subscribed":false, "lastTickAt":null`——即使 2330 在訂閱清單裡（tier 4，
     `connection_a` 含 `2330`），**prod 端認知的訂閱狀態仍是「未真正訂閱／無 tick」**。
3. **交易台實圖複驗**：FAIL — 桌機 1920 截圖跟上午一模一樣，主報價 header 仍「尚無報價」/`--`，
   自選清單 10 檔仍全 `---`，下單票委託價仍靜態 `1085.00`。前端沒有活過來（預期中——`ticks` 端點本身
   在 prod 側都還沒有資料，前端無論如何都拿不到）。截圖：
   `C:\Users\User\AppData\Local\Temp\claude\C--Users-User\0c6b807e-1c05-4738-8a22-c4dd496052d3\scratchpad\desk_diag_20260716_postfix\desktop_portfolio_postfix.png`
4. **cap 40 快查**：PASS（無互撞跡象）——`slotsUsed:21/40`，跟上午診斷時一致，未觀察到暴衝或槽位競爭。
5. **subscribe 涵蓋清單**：2330 有在 `connection_a` 訂閱清單內（tier 4 core），2330 是有掛號的，
   問題不是「沒訂閱」，是「訂閱了但沒收到真 tick」（跟上午 KGI_QUOTE_PROBE 報告定性的「gateway 全盲、
   `subscribed` 掛號成功不代表真的在收 tick」現象一致）。

### 判讀 / 建議
- **EC2 本機日誌看到的 `Websocket connected` + tick buffer 增長，跟 prod API 觀察到的狀態不一致**——
  可能原因（供 Jason 排查，Bruce 不猜測代碼、不越權查 EC2）：
  - EC2 gateway 重啟後，Railway 側的 prod API 進程可能還連著重啟前的舊 gateway 連線/舊 buffer，
    需要 API 側也重連或重啟才能拿到新 buffer 內容；
  - 或 EC2 本機日誌看到的 tick 流入的是**內部 buffer**，跟這幾支 API 端點讀取的 buffer/資料表是不同
    的資料路徑，中間可能還有一層同步/relay 沒接上；
  - 或訂閱在重連後需要重新 `POST /quote/subscribe` 才會真的推播（gateway 端連上 socket 不等於
    subscription 狀態自動復原）。
- **建議**：Jason 複查 prod API（Railway service）是否需要對 EC2 gateway 重新建立連線／重新送
  subscribe，不能只看 EC2 本機 log 判定「行情腿活了」，下一輪修復後複驗一樣走這篇的 curl 序列
  （`/kgi/quote/ticks`＋`/kgi/status`＋`/kgi/quote/subscription-status`，兩次探測比對 `last_quote_time`
  是否真的前進）。
- **是否可宣告收口**：不可。TLS 憑證鏈修復本身（EC2 端）可能是必要的一步，但**尚未證實端到端生效**，
  🔴 主報價/自選清單斷線症狀原封不動。收盤時間 13:30 TST 逼近，若要盤中再驗，需儘快重跑本節序列。

---

## 三輪終驗 — 2026-07-16 10:52-10:54 TST（同日再追加，Bruce-3, owner session, prod, 唯讀＋僅 1 個 smoke POST）

**背景**：Jason 查明第二根因——`kgi-subscription-manager.ts` 永久 tier 從未真正呼叫 `gatewaySubscribe`
（結構性死碼，即上一節看到的 `subscribed:false`）。已 ops 直接對 gateway 訂閱 19 檔（含 2330），EC2 本機
`ticks`/`bidask` 已回真資料。要求驗 prod stateless proxy 端點是否也通。

### 結論：**PASS（主報價 header 已活）＋新發現一個側面 regression（五檔盤口因 response shape 不符變空白）**

1. **`GET /kgi/quote/ticks?symbol=2330`**：**PASS** — 回真 tick：
   `close:2435, open:2430, high:2450, low:2420, datetime:"20260716104737"`（10:47:37 TST），
   `total_volume:11261`。跟同時間 TWSE 官方 MIS 交叉比對（`curl mis.twse.com.tw ... tse_2330.tw`，
   10:52:05 快照）：官方 `b(買一)=2435.0000, a(賣一)=2440.0000`，跟 KGI tick close=2435 完全吻合、
   跟 bidask 買一/賣一（下述）也完全吻合，**誤差 = 0**（同一 top-of-book）。這支端點本身就是 KGI-only
   （`source` 隱含=kgi，非 twse_mis fallback 分支）。⚠️ **但 `freshness:"stale", stale:true,
   buffer_used:1`**——兩次探測（02:52:07、02:53:39 UTC，間隔 ~90s）資料**逐字不變**，是 Jason ops 一次性
   直連訂閱打進來的**單一快照**，尚未證實已恢復「持續推播」（跟開盤前 42 天斷線的「零推播」不同，但也
   還不是「穩定持續 tick」，是中間態，判讀見下）。
2. **`GET /kgi/quote/bidask?symbol=2330`**：**PASS（來源已切換）但發現新副作用**——回應內容確認來源已
   從 twse_mis 切到 KGI 原生（買一 2435/賣一 2440，跟官方 MIS 及 ticks 完全吻合），**但 response shape
   從原本 twse_mis fallback 的扁平結構（`data.bid_prices`/`data.ask_prices`/`data.source:"twse_mis_intraday"`）
   變成巢狀結構（`data.bidask.bid_prices`/`data.bidask.ask_prices`，無 `source` 欄位、多了
   `data.freshness`/`data.stale`）**。前端 `renderDepth()`（`desk-exact/index.html` L959+）讀的是
   `d.ask_prices`／`d.bid_prices`（扁平层级，對應舊 twse_mis shape），**沒有解到新的巢狀 `d.bidask.*`
   路徑**，導致 `askP`/`bidP` 兩個陣列都變空——**五檔盤口從「有 twse_mis 假資料」退化成「完全空白」**
   （畫面顯示 `depth-hint` 的「KGI 唯讀五檔目前尚未回傳，系統持續輪詢中」文案，但其實資料已經到了，
   只是前端解析路徑對不上）。這是本輪修復意外引入的**新 regression**，需回報。
3. **`POST /kgi/sim/quote-smoke`（owner，body `{}`）**：**PASS** — `200 OK`，
   `{"ok":true,"tickReceived":true,"productQuoteProvider":"kgi","productQuoteUsable":true,
   "tickSample":{"close":105.8,"symbol":"0050","datetime":"20260716104746"}}`；隨後
   `GET /kgi/status` 的 `last_quote_time` **從凍結值 `2026-07-16T01:06:58.222Z` 更新為
   `2026-07-16T02:52:45.596Z`**（跟 smoke 的 `finishedAt` 精確對齊），證實 Jason 的定性（只有 smoke 會寫
   這個旗標）正確，該欄位本身不能單獨拿來判斷「是否持續在收 tick」。
4. **交易台實圖**：**PARTIAL PASS** — 主報價 header 活了：「2,435.00 ▼5.00 -0.20% 即時 tick」＋
   開/高/低/昨收/量全部真數字，跟上午「尚無報價」/`--` 對照是實質改善。自選清單 **10 檔中 5 檔活了**
   （2330/2454/2317/2881/2308 有真價），**另 5 檔（2382/3661/3035/2618/3443）仍全 `--`**——非同一 bug，
   查證是**這 5 檔根本不在 KGI 訂閱白名單內**（直接查 `/kgi/quote/ticks?symbol=2382` 等回
   `SYMBOL_NOT_ALLOWED: not on the quote whitelist (KGI_QUOTE_SYMBOL_WHITELIST)`），屬既有
   cap 40／白名單容量限制範圍內的已知結構限制，非本輪新壞況。**五檔盤口如上第 2 點退化為空白**
   （新 regression）。「今日委託」仍混雜跨日資料（沿用上午已記錄的既有 🟡，非本輪新增）。截圖：
   `C:\Users\User\AppData\Local\Temp\claude\C--Users-User\0c6b807e-1c05-4738-8a22-c4dd496052d3\scratchpad\desk_diag_20260716_final\desktop_portfolio_final.png`
5. **`subscription-status` 補充**：`slotsUsed` 仍 21/40，但**全部 21 個 slot 的 `subscribed` 欄位仍是
   `false`**（即使 ticks/bidask 已證實在收真資料）——跟 Jason 定性一致：這個追蹤旗標本身是死碼，
   拿它判斷「有沒有在收 tick」不可靠，下次驗證改直接打 `ticks`/`bidask`/`quote-smoke` 三支活資料端點，
   不要信 `subscription-status.subscribed`。

### 判讀
- 這次是**真的進展**：ops 直連訂閱讓 KGI 原生資料端到端流進 prod，主報價/多數自選清單/quote-smoke
  三項證實活了，價格跟 TWSE 官方 MIS 交叉核對完全吻合。
- 但**不是完全收口**：(a) 五檔盤口因為 response shape 改變（twse_mis 扁平→KGI 巢狀）在前端解析失敗，
  從「有假資料」退化成「空白」，是本輪修復產生的新前端 bug，需要 Jim/Codex 或 Jason 補一行 unwrap 邏輯
  改讀 `d.bidask.ask_prices`／`d.bidask.bid_prices`；(b) 目前只看到「一次性快照」（`buffer_used:1`，
  兩次探測不變），還沒有證據證明會**持續刷新**（`kgi-subscription-manager.ts` 的死碼本體還沒修，
  ops 手動訂閱是否撐得過重連/斷線需要後續觀察，不能現在斷言「行情腿已根治」）。

### 是否可 deploy / 是否可宣告收口
- 本輪純驗證，未改代碼、未部署，僅 1 個 owner smoke POST（無副作用寫 audit 屬預期）、0 筆下單。
- **仍不可完全宣告收口**：核心 🔴（主報價斷線）已證實**大幅改善**（非零進展，值得跟楊董更新），但
  ①五檔盤口新退化成空白是需要修的新 bug ②持續穩定推播尚未經時間證實 ③`kgi-subscription-manager.ts`
  死碼本體修復（非 ops 繞過）仍待 Jason 收尾。建議 Elva 跟楊董說「行情腿主要症狀已修好一半，盤口顯示
  另有新發現的前端小 bug 在修，非樂觀宣告全好」。

---

## #1284 部署後盤後態驗收 — 2026-07-16 18:58-19:04 TST（Bruce-3, owner session, prod, 唯讀）

**背景**：PR #1284（squash `a4b130c7`，Pete APPROVED 0🔴/3🟡）合main，修交易台六項：header/watchlist
client-side fallback（`fetchEffectiveQuotes()`）、五檔盤口 `normalizeBidAsk()` 雙 shape 相容、下單票
`seedTicketPrice()` 動態帶價、`isTodayTaipei()` 今日委託過濾、SYMBOL_NOT_ALLOWED 白名單外誠實態、
stale 快照「凱基（HH:mm:ss 快照）」標示。驗證窗口天然落在 KGI gateway 14:10 排程關機後（19:0x TST，
盤後 5.5 小時），正好是「fallback 只在盤後露餡」的活測場景。

### 部署確認
- GHA `Deploy to Railway` run `29492720843`：`in_progress` → `completed success`（10:58:23→11:02:51
  UTC，約 4.5 分）。
- **web 內容標記驗證**（非信 API buildCommit，遵守 web≠API deploy 時序鐵律）：owner cookie 直連
  `GET https://app.eycvector.com/desk-exact/index.html`（未登入直連該靜態檔已改走登入牆 307，需帶
  session cookie），`Last-Modified: 2026-07-16T10:58:57Z`（精確對齊 deploy 完成時間）；grep 命中
  `快照`×4、`normalizeBidAsk`×2、`isTodayTaipei`×2、`seedTicketPrice`×4、`fetchEffectiveQuotes`×3；
  舊寫死 `1085.00` 命中數 0（已清除）。**PASS — web 端確認部署到位**。

### 四點桌機 1920 實圖驗收（owner session，`/portfolio` 正式 route，非 `/desk-exact` 預覽）
真瀏覽器 Playwright 登入 `qazabc159@gmail.com` → `/portfolio` → 讀 `desk-exact` iframe DOM。**首次探測
撞上已知的 cold-cache 假象**（`/market-data/effective-quotes` 冷快取首讀回 `items:[]`，重打即回真資料
——同「cold-cache double-read trap」舊坑，非本輪新規），重跑後四項判準：

1. **header + 自選 10 檔全部有值，零「尚無報價」** — **PASS**。header 顯示 `2,470.00 ▲+30.00 +1.23%`，
   狀態標籤「手動資料即時」；自選清單 10/10 檔全部真數字（2330/2454/2382/2317/3661/2881/3035/2618/
   3443/2308），無一 `---`。頁面全文 `尚無報價` 命中數 = 0（原本應為 1+，含 header）。⚠️ 🟡 標籤字面
   「手動資料即時」對應 `selectedSource==="manual"`——這是 `effectiveQuoteStateLabel()` 既有 srcLabel
   映射表的既有措辭（非本輪新增邏輯），語意上這批資料實為收盤持久化快照（`timestamp` 精確落在
   `05:30:00.000Z`=13:30:00 台北收盤），對使用者顯示「手動資料」可能被誤解為人工輸入而非官方收盤價
   ——非本輪 blocker，記錄供 Elva/Jim 下一輪措辭優化參考。
2. **五檔盤口有值或誠實盤後態，與 header 不矛盾** — **PASS**。`/kgi/quote/bidask` 回
   `{"error":"GATEWAY_UNREACHABLE"}`（gateway 14:10 排程關機後預期行為），面板顯示誠實文案「KGI 唯讀
   五檔目前尚未回傳，系統持續輪詢中，非系統故障」，跟 header 有收盤快照值不衝突（深度簿本身收盤後
   本就無「五檔」概念，這是合理的域差異，非 bug）。
3. **下單票委託價跟隨標的帶值** — **PASS**。委託價欄位 `2470.00`，精確等於 2330 目前顯示的 last
   price（非固定 1085、非 NaN、非 0），`seedTicketPrice()` 生效。
4. **「今日委託」只含 7/16 台北日單** — **PASS**。UI badge「今日委託 7」；直接 curl
   `GET /api/v1/uta/orders?limit=10` 拿到 12 筆原始資料（7/16 ×7、7/15 ×3、7/14 ×2 混雜，後端本身
   不分日期，符合 Pete review 🟡#2 指出的既有殘留 cap 行為），前端 `isTodayTaipei()` 過濾後畫面精確
   只留 7/16 的 7 筆，含今天中午 e2e 的 2882 三筆（買 `10:09:50`、賣 `10:09:57`、賣 `10:10:27` TST）。

### 與早上壞圖並排對照
早上 10:1x 診斷截圖（`desk_diag_20260716/desktop_portfolio.png`）：header「尚無報價」+ 價格 `--`、
自選 10 檔全 `---`、委託價寫死 `1085.00`。本輪 19:0x 截圖（`desk_1284_postdeploy_verify/
desktop_1920_postdeploy.png`）：header 真值 `2,470.00 +1.23%`、自選 10/10 檔真值、委託價動態
`2470.00` 跟隨標的。**一句話結論：楊董點名的「壞」（報價空白矛盾+委託價寫死）在盤後態下已解除**，
唯一新增的 🟡 是「手動資料」標籤措辭可能被誤讀為非官方資料，建議下一輪順手改得更準確（如「收盤快照」）。

### 證據
- `reports/sprint_2026_07_16/desk_1284_postdeploy_verify/desktop_1920_postdeploy.png`（桌機 1920 全頁）
- `reports/sprint_2026_07_16/desk_1284_postdeploy_verify/header_zoom.png`（header 標籤特寫）
- `reports/sprint_2026_07_16/desk_1284_postdeploy_verify/depth_panel_zoom.png`（五檔盤口誠實態特寫）
- Deploy run: https://github.com/qazabc159-blip/iuf-trading-room/actions/runs/29492720843
- PR: https://github.com/qazabc159-blip/iuf-trading-room/pull/1284（merge `a4b130c7`）／
  Pete review: `reports/sprint_2026_07_16/PETE_1284_REVIEW_2026_07_16.md`（APPROVED, 0🔴/3🟡）

### 是否可 deploy / 是否可宣告收口
- 本輪純驗證，未改代碼，僅唯讀 GET + 1 次 owner 登入，0 筆下單。
- **可宣告本輪 P0（楊董點名「交易台還是壞的」）症狀解除**：4/4 驗收點 PASS。殘留 3 項非阻斷 🟡（Pete
  review 既有 3 條 + 本輪新記 1 條「手動資料」標籤措辭），建議排入下一輪 backlog，非緊急。
