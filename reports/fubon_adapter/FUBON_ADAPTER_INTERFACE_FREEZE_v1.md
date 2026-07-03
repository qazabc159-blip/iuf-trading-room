# Fubon Adapter 介面凍結 v1 ＋ UTA Phase A 殘工對照（Fable 5 定版 2026-07-03）

**地位**：Phase II 真金線的工程介面契約。凍結**我方**的介面形狀，讓 jason lane 在楊董的富邦開戶/API 申請（安全閘 spec O-4，**尚未申請**）下來之前就能動工骨架；SDK 細節映射留 TBD 欄位，文件到手補完即可，不改介面。
**架構前提**（楊董 6/17 裁決＋法規）：Option A 客戶自跑 gateway、憑證永不上傳、證交法 159 禁全權委託。

## §1 核心裁決：Fubon 複用 KGI gateway 線協議（Broker-Agnostic Gateway Protocol）

KGI 已打通的鏈 = 配對（#1143/#1144）＋gateway HTTP 服務（`services/kgi-gateway/app.py`）。
**誠實更正（v1.1，read-back 實查 app.py 抓出）**：KGI gateway 的實際端點是 `/session/show-account`、`/account/list`、`/position`（單數）、`/trades`＋`/deals`，**沒有** `/balances`、`/order/cancel`；v1 宣稱「照抄不發明」對 4/7 端點不成立。
**修正後裁決**：GAP-v1 = **新的正規化契約**（本檔定義），Fubon gateway **原生實作** GAP-v1；KGI gateway **不改**（grandfathered），其差異由既有 `kgi-gateway-client.ts` 在 API 層適配 — 兩邊在 `fubon-gateway-client.ts`/`kgi-gateway-client.ts` 之上呈現同一個 BrokerPort。配對/心跳/撤銷鏈（#1143/#1144）兩邊真正共用零改動。
- 好處：配對 UI（#1151）、`broker_gateway_pairings` 表、心跳/撤銷全部零改動直接用；W6 檢查模式可平移。
- Fubon gateway = 新 Python 服務 `services/fubon-gateway/`（客戶端執行），對內叫富邦 Neo SDK，對外實作 GAP-v1。

## §2 GAP-v1 線協議凍結（gateway 對 API server 的 HTTP 契約）

| 端點 | 方法/Auth | 語意 | 凍結回應形狀 |
|---|---|---|---|
| `/health` | GET／無 | 存活＋`{ok, broker:"fubon", is_simulation, read_only_mode}` | 必含 `is_simulation` 布林 |
| `/session/status` | GET／gateway token | 登入態＋帳號遮罩（KGI 對應物=`/session/show-account`，僅 Fubon 原生實作本名） | `{logged_in, account_masked, env}` |
| `/positions` | GET／gateway token | 持倉（KGI 對應=`/position` 單數；GAP-v1 統一複數） | 對齊 UTA positions shape（qty 一律**股**計） |
| `/balances` | GET／gateway token | 資金（**GAP-v1 新增**，KGI 無對應 — KGI 線資金另來源） | `{cash_available, ...}` TWD 整數分離小數 |
| `/order/create` | POST／gateway token | 送單 | **必含三閘**（見 §3）；成功回 `{external_order_id, status}` |
| `/order/cancel` | POST／gateway token | 撤單（**GAP-v1 新增**，KGI gateway 現無此路徑 — UTA-C1 若需 KGI 撤單走 client 層適配） | 同 stage-gate；冪等（重複撤回 already_cancelled） |
| `/orders/today` | GET／gateway token | 當日委託+成交回報（KGI 對應=`/trades`＋`/deals` 兩支；GAP-v1 合一） | 對齊 `unified_orders` 欄位名（見 §4） |
- 錯誤碼字面量凍結（v1.1 更正，對齊 KGI 實際命名慣例 `KGI_READ_ONLY_MODE_BLOCKED` 帶前綴）：`FUBON_LIVE_DISABLED_STAGE_GATE`（見 §3.2，**刻意不叫 LIVE_ORDER_BLOCKED**）／`FUBON_READ_ONLY_MODE_BLOCKED` — 這兩個 W6 會 grep。`SESSION_EXPIRED`／`RATE_LIMITED` 降級為建議命名（v1 誤標凍結 — 全站零命中，是發明非現況），不入 W6。
- 心跳：gateway 主動 `POST api.eycvector.com/api/v1/uta/gateway/heartbeat`（既有 #1144 端點，零改動）。

## §3 安全不變式（照抄 KGI 四層＋安全閘 spec，Fubon 版一層不少）

1. gateway 進程 `FUBON_READ_ONLY_MODE` env 預設 **true**（mutation 全 403）— 對應 `read_only_guard.py` 模式。
2. `/order/create` 閘（v1.1 語意修正 — read-back 抓到最重要的一條）：KGI 的 `LIVE_ORDER_BLOCKED` 在源碼註解明寫 permanently disabled，是**永久硬線**；Fubon 按 Phase 4 規劃**終將送真單**，性質不同，**不得復用同一字面量偽裝同等安全等級**。定版：Fubon gateway 檢查 env `FUBON_LIVE_TRADING_ENABLED`（預設 false）→ false 時 409 `FUBON_LIVE_DISABLED_STAGE_GATE`。W6 Check-F1 驗的不只是字面量存在，而是「guard 讀該 env 且預設 false」的條件形狀（grep env 名＋default 賦值行）。解鎖=安全閘 spec §9 Stage 順序＋G-LIMIT gateway 側複本仍在。
3. API 側：`fubon-broker-adapter.ts` 的 write 路徑掛 `FUBON_ORDER_WRITE_LOCKED = true` 硬編碼常數（對應 KGI L1）＋新檔案**加入 harness hook 保護清單**（`C:/Users/User/.claude/hooks/protect_real_money_paths.py` 追加兩行：`broker/fubon-broker-adapter.ts`、`fubon-gateway/`）。
4. W6 audit 腳本擴充：Check-F1 驗 stage-gate 條件形狀（env 名＋預設 false，非僅字面量）、Check-F2 驗 `FUBON_ORDER_WRITE_LOCKED=true`、Check-F3 驗 `FUBON_READ_ONLY_MODE` 預設 true — **與 Fubon 骨架同 PR 進**，不留窗口。

## §4 API 側檔案與型別凍結

- 新檔（照 broker/ 現有結構）：`fubon-gateway-client.ts`（HTTP client，鏡像 `kgi-gateway-client.ts`）／`fubon-broker.ts`（BrokerPort 實作）／`fubon-broker-adapter.ts`（UTA wrapper）；`broker-account-resolver.ts` 的 `adapterKeyToBrokerKind` 加 `fubon→fubon` case；F2 設計的 channel 分流加 `fubon` channel（Stage 2 前回 `channel_coming_soon`，Stage 2 起走 client）。
- 型別：全部復用 `packages/contracts` 既有 order/position schema；`quantity_unit` 依 F2 D4 必填無 default；**股/張換算在 adapter 層做、gateway 對外一律股** — 換算錯=千倍事故，單元測試釘死（1 LOT=1000 股、零股單獨立路徑）。
- **SDK 映射 TBD 表**（O-4 文件到手時填，填表不改介面）：Neo SDK 登入/憑證載入方式｜order 欄位對應（BS/價格型別/委託條件）｜回報推送機制（callback vs polling）｜sim 環境有無。**若富邦文件證明某介面假設錯誤 → 開 v2 修訂並記差異，不硬套。**

## §5 驗收測試清單（實作 PR 必附）

1. 配對生命週期 e2e（照 #1144 驗法）：unpaired→pending→reachable→revoke→401。
2. read e2e：mock gateway 回固定 fixture → `/uta/accounts` gatewayStatus 正確、positions/balances 進 UTA 讀面。
3. 安全：非 sim session 送單 409（字面量斷言）；read_only 預設擋 mutation；W6 Check-F1~F3 綠。
4. 換算：LOT/SHARE 雙向換算測試＋零股邊界。
5. 未拿到富邦測試環境前，全部跑 **contract-mock gateway**（一支 ~100 行 fake 實作 GAP-v1）— 這支 mock 本身就是 GAP-v1 的可執行規格，先寫。

## 附錄：UTA Phase A 殘工對照（「剩 6 成」的實際分解）

| 殘工 | 歸屬 | 狀態 |
|---|---|---|
| unified_orders 沒人寫入 | **F2 PR-1 吸收**（先記帳後送單） | 已設計 |
| /uta/accounts 空表、broker strip 吃 adapters | **F2 PR-2＋PR-4 吸收**（seeding＋帳號帶） | 已設計 |
| `getUtaOrders()` 孤兒 client | **epic 切片④吸收**（委託回報面板讀 /uta/orders） | 已設計 |
| /uta/orders schema 缺 quantity_unit | **F2 D4 吸收** | 已設計 |
| 撤單統一路徑（cancel 經 unified 管道+記帳） | **新工單 UTA-C1**（jason，1 PR）：`POST /trading/orders/:id/cancel` → channel cancel → unified_orders 狀態機 cancelled；驗收=paper 撤單 e2e＋KGI SIM 撤單 e2e | 本文件新切 |
| 委託狀態輪詢/回報更新（submitted→filled 的 DB 同步） | **新工單 UTA-C2**（jason，1 PR）：盤中輪詢 `orders/today` 比對 update（複用 kgi-order-reconciliation 模式）；驗收=SIM 單成交後 /uta/orders 狀態翻轉 | 本文件新切 |
| Fubon adapter 骨架＋mock gateway | **新工單 UTA-C3**（jason，1-2 PR）：本文件 §2-§5 | 本文件即規格 |
結論：Phase A 收尾 = F2 五 PR＋UTA-C1/C2/C3，全部 sonnet 可執行，無殘餘 Fable 級判斷。

---
## 版本紀錄
- v1 2026-07-03 Fable 5 定版。依據：F1 安全閘 spec／F2 下單流設計／#1143-#1144 配對鏈實掃。O-4（富邦文件）到手後填 §4 TBD 表。
- v1.1 同日：fresh read-back（實查 app.py 對照）修 3 大 — ①「照抄 KGI」更正為「GAP-v1 新正規化契約、KGI grandfathered 由 client 層適配」，逐端點標注 KGI 對應物與新增項 ②錯誤字面量對齊帶前綴慣例、發明項降級為建議 ③**LIVE_ORDER_BLOCKED 語意衝突修正**：KGI 永久硬線 vs Fubon 計畫性解鎖不得共用字面量 → `FUBON_LIVE_DISABLED_STAGE_GATE`＋W6 驗條件形狀非僅字面量。
