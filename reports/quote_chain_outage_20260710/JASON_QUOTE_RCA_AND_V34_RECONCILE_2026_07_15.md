# 路 B 行情回流根因診斷 + v34 reconcile 缺口修復 — 2026-07-15（Jason）

承接 Bruce `PATHB_POST_DEPLOY_VERIFY_2026_07_15.md`（Gate②/⑤ 未過）。本輪窗口 12:5x–13:1x TST（收盤前）。
EC2 gateway = `i-03762861d4ce08932`（ap-east-2，service `KGIGateway`），全程 SSM `AWS-RunPowerShellScript`
唯讀查詢（讀 log / curl 127.0.0.1:8787 / `Get-Item`/`Get-Process`/`certutil -hashfile`），未改任何 EC2 檔案。
主 repo working tree 停在 `fe3e427b`（2026-07-01），本輪一律 `git show origin/main:<path>` 或用當日部署
worktree `IUF_DEPLOY_WORKTREES/pathb-deploy-20260715`（HEAD `97526496`，EC2 實跑代碼）查證，未動 working tree。

---

## A. `raw_quote_connected:false` 根因 — 兩層問題疊加

### A-1（觀測面／已足夠解釋 Bruce 看到的現象）：`raw_quote_connected` 這個 flag 結構性量錯腿

- 語意鏈：`GET /api/v1/kgi/status`（`apps/api/src/server.ts:4660`，origin/main）
  `raw_quote_connected: state.quoteConnected` — `state` 來自 `getKgiSimState()`
  （`apps/api/src/broker/kgi-sim-env.ts`，🔒 真金鎖檔）。
- `_state.quoteConnected` 只有一個寫入來源：`runSimQuoteSmoke()`
  （`kgi-sim-env.ts:413-533`），在 `health.kgi_logged_in` 讀到後於第 458 行
  `_state.quoteConnected = result.loggedIn` 賦值，並在 subscribe/tick 失敗路徑於
  345/360/382/389/449/529 行寫回 `false`。
- `runSimQuoteSmoke()` 只被兩處呼叫：① Owner 手動 `POST /kgi/sim/quote-smoke`；
  ② `runKgiSimDailySmokeSchedulerTick`，其視窗是 **09:05–09:35 TST，每日一次**
  （`server.ts:18374-18384` 註解明載："KGI SIM daily smoke cron: 09:05-09:35 TST...
  Window starts after the EC2 gateway's 08:20 EventBridge boot"），且對象是
  **SIM 帳號的 quote leg**（`iquotetest.kgi.com.tw`），跟今天路 B 新接的
  **live quote_session 腿完全是兩條線**。
- 今天路 B 的 live quote leg 是在 ~12:01–12:11 TST 才修好上線（見 A-2 時間戳），
  遠晚於 09:05–09:35 的每日 smoke 視窗。也就是說：`raw_quote_connected` 這個
  Railway API 側 in-memory flag，**今天從頭到尾都不曾被任何一次成功的 live quote
  smoke 更新過**——它反映的是今早 09:05–09:35 SIM quote leg 的（失敗）結果，不是路 B
  修好後的 live quote_session 狀態。
- 這解釋了 Bruce 觀察到的「`kgi_logged_in:true` 但 `raw_quote_connected:false`
  並存」——不是 bug 在回報錯誤的即時狀態，而是這個 flag **從未被設計成覆蓋 live quote_session
  這條路 B 新腿**，是一個純觀測面缺口（stale metric，非資料流本身壞掉）。
- `effectiveQuoteConnected`（`server.ts:4648-4650`）有正確 fallback 到即時查
  gateway（`gatewayLoggedIn && gatewayQuoteAuth.available !== false`），所以
  `quote_connected`（非 raw）欄位在 Bruce 查詢當下應已是 `true`——`raw_quote_connected`
  只是一個附加的除錯欄位，語意上就不該被當作「行情真的在流動」的判準。
- **修法方案（🔒 需碰 `kgi-sim-env.ts`，我不動手）**：`runKgiSimDailySmokeSchedulerTick`
  / 或一個新的獨立 live-quote-session 存活探針，應該在路 B 上線後也對 `quote_session`
  （而非只有 SIM 的 `iquotetest`）跑一次 tick-received 驗證，並把結果寫回一個新欄位
  （例如 `state.liveQuoteSessionConnected`），不要繼續用同一個 `quoteConnected` 欄位
  混裝兩條完全不同的 quote leg。

### A-2（產品面／真正的 BLOCKER，Bruce 已抓到，本輪往下鑽一層）：live quote_session
  的 tick 訂閱在 SDK 層「掛號成功」，但真實推播從未進來

**證據鏈（全部來自 EC2 `C:\kgi-gateway-logs\gateway.stderr.log`，SSM 唯讀讀取）：**

1. 路 B 上線前（07-14 全天至 07-15 03:15 UTC）：每次 `subscribe_tick` 呼叫都是
   ```
   kgi_gateway WARNING subscribe_tick quote unavailable: KGI_QUOTE_AUTH_UNAVAILABLE:
   login succeeded but market-data token/Quote is unavailable
   ```
   （對應 `services/kgi-gateway/kgi_quote.py:60-77` 的 `_resolve_stock_quote()` 拋出
   `KgiQuoteUnavailableError`，因為 `quote_session` 那時還沒登入成功）。

2. 路 B live quote leg 修好之後（04:11:28 UTC = 12:11:28 TST 起）：
   ```
   [2026-07-15 04:11:28] INFO - Subscribed tick: symbol=2330 label=tick_2330
   [2026-07-15 04:11:28] INFO - subscribe_tick OK: symbol=2330 label=tick_2330
   ```
   同樣模式後續對 2317 / 1303 / 2454 也都出現「OK」——即 `quote_manager.subscribe_tick
   (quote_session.api, symbol, ...)`（`app.py:823`，路 B 版）**在 SDK 呼叫層完全沒有拋例外**，
   `_resolve_stock_quote()` 也**沒有**走到 hydration fallback 分支（全程 grep
   `"Hydrated missing kgisuperpy stock Quote wrapper"` 零命中，代表 `api.Quote`
   是原生可用，不需要走 `kgi_quote.py:44-77` 那個已知脆弱的手動 hydrate 路徑）。

3. 但 access log（`gateway.stdout.log`）顯示同一時段起，`GET /quote/ticks?symbol=2330`
   持續整個驗證窗（12:1x–13:1x TST）回 `200 OK`（代表 subscribed=true，非 404
   "not subscribed"），這與 Bruce 直接讀 body 得到 `count:0, ticks:[]` 一致——
   HTTP 層「有訂閱」，資料層「零筆」。

4. `kgi_quote.py:224-235` 的 `on_tick` callback 是**唯一**會寫入
   `_TICK_BUFFER`（`_write_tick_to_buffer`）的路徑；它只在 KGI SDK 內部執行緒真的
   收到市場推播時才會被呼叫。全程 grep `"Error in on_tick bridge"` 零命中——不是
   callback 出例外被吞掉，而是 **callback 從頭到尾沒被觸發過**。

**結論（flag 語意 → 實際狀態 → 為何不一致）**：
- `subscribe_tick` 這個動作本身（本地 SDK 物件登記訂閱意圖）＝成功。
- KGI 伺服器端「真的把即時 tick 推播回這條連線」＝在 2330（台股成交量最大的個股，
  盤中 12:11–13:15 顯然持續有真實成交）身上整整一小時內零筆——用最活躍的個股做
  10 分鐘窗仍是 0，可排除「這檔冷門沒人成交」的解釋。
- 斷點不在 `kgi_quote.py` / `app.py` / `kgi_session.py` 的橋接邏輯（都正確execute
  且無錯誤），而是在 **`kgisuperpy` SDK 內部 socket/session 層，或 KGI 伺服器端對
  這個 live 帳號的即時行情推播權限（entitlement/tier）**——這與 7/13 已定案的
  「SIM 帳號行情會員等級空白（TOKEN_EMPTY）」是**同一類問題的姊妹版本**：SIM 帳號
  當時是完全沒有 quote member level；live 帳號雖然「login 成功、Quote 物件原生可用、
  subscribe_tick 呼叫不拋例外」，但從未有任何自動化測試正面驗證過它的**即時推播**權限
  （對照 SIM 側自己就有 `runSimQuoteSmoke` 主動驗 tick-received；live quote_session
  完全沒有等價的存活探針，見 A-1 的修法方案）。
- **本輪未能進一步下鑽的原因**：`kgisuperpy` 是閉源第三方 SDK，且其登入/訂閱/推播
  三層的核心邏輯落在 `services/kgi-gateway/app.py` / `kgi_session.py`（🔒 真金鎖檔），
  不在我可動手範圍；本診斷已到達「gateway 側程式碼正確、問題在 SDK 內部或 KGI
  伺服器端帳號權限」這個可行動的邊界。

**建議下一步（需 owner 決定，我不動手）**：
1. 用 KGI 官方診斷管道（客服/業務窗口）直接問「live 帳號的即時 tick 推播（非僅登入）
   權限是否已開通」——這是最快排除路徑，且與 7/13 SIM 帳號 TOKEN_EMPTY 的處理管道相同。
2. 若要工程側自證，需要在 `kgi_session.py`/`app.py`（鎖檔）加一個「訂閱後 N 秒內若
   零 tick，回報 `subscribe_registered_no_data` 而非籠統的 `ok:true`」的主動驗證——
   這樣 `raw_quote_connected`（見 A-1）才有機會被正確語意的探針餵值。
3. **一個獨立、可疑、值得記錄但本輪未查證的旁證**：`app.py`/`kgi_quote.py` 在 EC2
   上的 log 檔內既有 `logging.basicConfig` 標準格式（`asctime name levelname message`）
   又有一段完全不同格式（`[timestamp] LEVEL - message`，無 logger name）。已排除
   「執行中程式碼與硬碟不符」的假說（`certutil -hashfile` 驗證磁碟上 `kgi_quote.py`/
   `app.py` 的 SHA256 與其原始碼逐行比對一致，行號吻合，`Subscribed tick`/`subscribe_tick OK`
   訊息文字與程式碼完全相符）；最可能是 `kgisuperpy` SDK 首次建立 live 連線時內部
   自己呼叫了 `logging.basicConfig(force=True, ...)` 覆蓋了格式（第三方 SDK 常見行為）。
   不影響本次結論，僅供下次排查記錄。

---

## B. v34 九筆 unconfirmed 委託 — 缺口修復（已交付，非僅診斷）

### B-1 為什麼卡在 unconfirmed（讀 `v34-sim-runner.ts` 得證，非猜測）

`apps/api/src/v34-sim-runner.ts:756-824`（origin/main）：每筆委託送出（`client.createOrder`）
成功後，**立刻**（同一個 tick、毫秒等級）呼叫一次 `reconcileKgiOrder()`
（`broker/kgi-order-reconciliation.ts:166`，非鎖檔），拿 `getRecentOrderEvents(100)` /
`getTrades(false)` / `getDeals()` 當下的快照去比對。KGI SIM 委託在真的被券商回報
確認前（即使是 SIM，也需要幾秒到幾十秒的處理延遲）比對不到證據，`reconcileKgiOrder`
就會回 `status: "unconfirmed"`（`kgi-order-reconciliation.ts:200` 的 default fallback）。
這個結果**只寫一次**進 `audit_logs`（`v34-sim-runner.ts:594-615`，`writeAuditRecord`），
之後**沒有任何排程再重新比對**——這正是 Bruce 說的「一次性快照，不會自動更新」的
程式碼層根因。

### B-2 這 9 筆到底有沒有送達 KGI SIM

- audit payload（Bruce 已讀出）：9 檔的 `status` 全是 `unconfirmed`（不是
  `rejected`），且 `failsafeNotes` 裡的 503 是 **`subscribeTick` 失敗**（訂閱行情，
  非下單本身），對照 `v34-sim-runner.ts:748-754` 的程式碼——`subscribeTick` 失敗
  是 non-fatal，明確設計為「不擋單」（註解：`Non-fatal: subscription failure
  doesn't block order submission`）。也就是說 503 只代表**行情訂閱**當時失敗
  （時間點 08:33 TST，早於路 B 修好——與 A 節時間戳吻合，那時 quote leg 確實還沒通），
  **與這 9 筆的下單/送達與否無因果關係**。
- 每筆的 `status:"unconfirmed"` 而非 `"rejected"` 本身就是強訊號：`v34-sim-runner.ts:796`
  的邏輯是 `accepted ? "accepted" : "rejected"` 起手，只有 `createOrder()` 呼叫
  **成功**（`accepted=true`）才會進入 reconcile 分支進而可能落到 `unconfirmed`；
  若 `createOrder` 本身失敗（三次重試後仍失敗），狀態會直接是 `"rejected"`，不會是
  `unconfirmed`。9 筆全部 `unconfirmed` 而非 `rejected`，代表 `createOrder()` 呼叫
  在 KGI 閘道端（trade session，SIM，非本輪 quote 問題）**確實回應了接受**——即
  9 筆 SIM 委託有送達 KGI SIM 閘道，只是「回報確認」在 runner 檢查的那一瞬間還沒到。
- **本輪未能查證的部分**：EC2 gateway 側是否留有這 9 筆委託各自的最終成交狀態
  （filled/cancelled/rejected）。gateway 的 `/trades`/`/deals`/`/events/order/recent`
  是即時查詢介面（無本地持久化資料庫），SSM 唯讀查 log 只能看到 HTTP 存取記錄
  （200/404/503），看不到委託內容本身；且 07-14（v34 首開日期）的訂單早已超出
  KGI SIM 當日結算週期，即使現在重新呼叫 `/trades` 也大概率查不到隔日的舊委託
  （這點與 Bruce 的 Gate④/⑤ 觀察一致——SIM 帳戶通常不保留跨日委託記錄）。

### B-3 修復：新增 v34 reconcile 端點（DRAFT PR，非鎖檔）

新增 `GET /api/v1/kgi/sim/v34-orders`（`apps/api/src/server.ts`），完整鏡射既有
`/api/v1/kgi/sim/orders`（V5-1/S1 專用）的機制，但讀 v34 的 audit 形狀：

- 讀 `audit_logs` 最近 7 天內 `action="v34_sim.order_submit"` AND
  `entityType="v34_sim"` 的最新一筆（v34 payload 沒有 S1 那層 `.data` 包裝，直接是
  `V34OrderSubmitReport`）。
- 用讀到的 `results[]`（`tradeId`/`stockId`/`shares`）重新對**當下**的
  `getRecentOrderEvents(200)` / `getTrades(false)` / `getDeals()` 呼叫
  `reconcileKgiOrders()`（跟 S1 用同一個共用純函式模組，未新增任何 reconcile 邏輯）。
- gateway 不可達時優雅降級為 `degraded:true` + 顯示原始 audit 快照（跟 S1 端點
  同款降級行為），不會 500。
- Owner-only，`prod_write_blocked:true`，不碰任何下單路徑——純讀查詢。

**與 v34_sim.order_submit 一次性快照的差異**：這個端點每次呼叫都是**即時重新查詢**
gateway 的 `/events/order/recent` / `/trades` / `/deals`，不是回放 audit 裡存的舊
`unconfirmed` 字串——只要 KGI 那邊之後任何時間點補上確認證據（trade_id 匹配），
下次呼叫這個端點就會得到更新後的狀態。這解掉 Bruce 說的
"BLOCKED_NO_RECONCILE_PATH"，但**不能**回溯查到 07-14 跨日的舊委託（見 B-2 最後一段，
KGI SIM 沒有跨日委託持久化，這是 gateway 本身的限制，非本端點能解）。

---

## 檔案清單

- `apps/api/src/server.ts` — 新增 `GET /api/v1/kgi/sim/v34-orders`（+約 250 行，
  完全鏡射既有 `/kgi/sim/orders` handler 的結構，無其他改動）
- `tests/ci.test.ts` — 新增 `V34-RECONCILE-1`（source-grep regression：路由存在／
  讀 v34 audit action+entityType／確實呼叫 `reconcileKgiOrders`+三個 gateway 讀端點／
  Owner-only 守門）

未動：`kgi-sim-env.ts`（🔒 真金鎖檔，A-1 修法只出方案）、
`services/kgi-gateway/*`（🔒 真金鎖檔，A-2 只出診斷）、
`broker/kgi-order-reconciliation.ts`（唯讀 import，未修改其內部邏輯）。
