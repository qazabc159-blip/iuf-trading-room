# 三 sleeve SIM go-live「零成交可見度」P0 診斷 — 2026-07-23

派工：Elva（P0，gateway 14:10 TST 關機前）。背景見派工訊息：53/53 單經 gateway
`/order/create` 全 accepted，但盤中 `GET /trades?full=true`／`GET /deals`／
`GET /events/order/recent` 三端點回空，且 8 週以來 `settlement_confirmed` 100%=0。

## 結論（單行）

**三選一皆非字面成立 — A（WS 斷線）與 B（SIM 不撮合）都被今早同一組 gateway 實測
數據直接反證；真根因是 C 的變體：deal/exec 回報有真實 20-60 秒級延遲，Elva
最初三次探測都做在延遲窗內（成交尚未回流），本診斷 09:43-09:46 TST 複測時
`/trades`／`/deals`／`/events/order/recent` 三者皆已完整回填真實資料。8 週
`settlement_confirmed`=0 的常態問題，根因在應用層（S1/V5-1/V3-4 sim-runner）
下單後只輪詢 3×1.5s＝4.5 秒就永久放棄，遠短於真實成交回報延遲，而非 gateway/SDK
層的連線或撮合問題。**

## 證據時間軸（UTC，TST=UTC+8）

| 時間 (UTC) | 事件 |
|---|---|
| 00:21:15 | gateway 啟動、KGI TradeCom TokenManager 完成握手（Login.log 有紀錄，非錯誤） |
| 00:35:00 | 手動 canary 單（1808）送出，accepted，trade_id 真值 |
| 01:23:35 | position circuit breaker tripped（Candidate F 既定行為，非本票範圍） |
| 01:24:02–01:24:21 | 53 單三批（C1/C3/v34_proxy）全部 `POST /order/create` 200 OK，gateway stdout 逐筆記錄 `SIM accepted` |
| 01:24:02–~01:24:50 | **每張單自己的 OrderReport(4010)/OrderPending(6002) ACK 在 <1 秒內回來**（stdout 逐行可見，`status: Success`） |
| 01:24:16–01:24:50 | 對應的 **ExecReport(4011)/Deal 回報在下單後 ~10–35 秒內陸續回來**（低階 `[kgiTradeCom::OnData] 4011` + `OnExecReport` 印出行，時間戳與 `/deals` 內 `ts` 欄位吻合，如 6219 送單 01:24:02 對應成交 ts=092448=09:24:48） |
| 01:29–01:38 | 我方多次以現有工具查驗（未觸發新單），確認 gateway process 未重啟、log 持續增長，無 TLS/連線錯誤 |
| **01:43–01:46（本診斷）** | `GET /deals` → **32 個 symbol 已有真實成交**（含 6219/6901/5522/8926/6026/6885/6265/2425/1808/4513/6177/8937/5351/5508/8171/2101/2883/4113/2886/6423/2892/2880/8383/2634/3093/2801/6535/2348/4174/2442/8047，價量與送單價完全吻合）；`GET /trades?full=true` → 正確回填「無效單」桶（含 1271/5267/6808 三筆 `MAT0015` 真失敗，非空桶假象）＋其餘 valid 委託；`GET /events/order/recent?limit=500` → **142 筆事件**，含每張單的 NewOrder Pending→Success 兩段式事件與 2 筆 Failed 事件 |

## 三選一逐項判定

### A（order-event WS 斷線，同款 7/16 TLS 病）— **反證**
- 若交易腿事件通道真的斷線，NewOrder(4010)/OrderPending(6002) 也不會回來——但 gateway
  stdout 顯示每一張單都在 <1 秒內收到 ACK，狀態正確從 Pending 翻成 Submitted/Success。
- ExecReport(4011) 本身也**確實有到**（見上表 01:24:16 起、以及本診斷複測時完整的 32
  symbol 成交），只是比 NewOrder ACK 慢個十幾到幾十秒，不是永久沉默。
- gateway.stderr.log 最後一筆 TLS/CERTIFICATE 類錯誤停在 **7/16**（今天 stderr 對
  Traceback/Error/Exception 的比對顯示今天 0 筆新錯誤）。
- **結論：A 不成立。** 交易腿的事件通道今天全程存活，跟 7/16 quote 腿 TLS 斷線是不同
  性質的問題。

### B（KGI SIM 環境不撮合，SDK 回應是空殼）— **反證**
- `/deals` 的成交價與送出限價逐筆吻合（例：6219 送價 15.65 → 成交 15.65 x7；2886 送價
  53 → 成交 53 x2），非隨機或預設值，證明是真實撮合結果，不是空殼假回應。
- `/trades?full=true` 的「無效單」桶正確裝了 3 筆真實 `MAT0015` 券商拒單（1271/5267/
  6808，皆 qty=0 疑似籃子縮量規則跳過但仍送出的殘留單），證明 SDK 撮合/風控管線是活的，
  不是永遠回傳文件範例的空殼 `{'無效單':[]}`。
- **結論：B 不成立。**

### C（其他）— **成立，具體機制如下**
1. **成交回報有真實延遲**：同一張單，NewOrder ACK 在送單後 <1 秒回來，但對應的
   ExecReport/Deal 平均落後 10–40 秒（依 symbol 撮合快慢不同），且回填是**漸進式**的
   （09:24 送出的 53 單，到 09:43-09:46 才觀察到 32 個 symbol 完整回填，另有 ~18 筆仍在
   `full=false` 的「未結」桶、3 筆確認失敗——尚有少數可能要更晚才成交或本身流動性不足未
   撮合，屬正常市場行為非系統故障）。
2. **Elva 最初三次探測（/trades full=true 空、/deals 空、/events/order/recent
   空）發生在這個延遲窗之內**——最合理的時間點是 canary（08:35）後不久，或主批次
   09:24 送完後立刻檢查（<20 秒內），此時 ExecReport 確實還沒回流，屬於「查得太早」的
   時間點假象，不是端點壞掉。
3. **8 週 `settlement_confirmed` 100%=0 的常態問題是應用層 bug，不是本次 gateway 診斷
   範圍**：既有記憶（`feedback`/RCA 7/22）記載 S1/V5-1/V3-4 三條 SIM 下單管線送單後只
   輪詢 `3×1.5s`＝4.5 秒就永久放棄確認，且不寫 `unified_orders` 表沾不到既有補輪詢
   cron。今天實測證實真實成交延遲是 10-40+ 秒起跳、且用了 20 分鐘才回填過半——4.5 秒的
   輪詢窗口在架構上**不可能**捕捉到任何一筆真實成交，這完全解釋了 8 週零確認的現象，
   且不需要假設 gateway/SDK 有任何連線或撮合缺陷。

## 附帶技術筆記（供接手排查用，非本票結論但可能誤導後續 debug）

- kgisuperpy SDK 的 `Order.get_trades(full=True)` 文件範例空狀態即為
  `{'無效單': []}`（見 `KGI_SUPERPY_VERIFY/brokerport_golden_2026-04-23.md` L191-194）—
  這是**正常空狀態的字面文件範例**，不是 bug 訊號，之前有人把這個字面值誤判成「壞掉」
  是可以理解的巧合（文件範例剛好長得像故障回應）。
- SDK 內部有一個 `_update()`/`ReceiveSReport()`「補檔」機制，只在 SDK 自己的
  `CA.py::set_Account()` 內部被呼叫一次（每次 `/session/set-account` 呼叫時，最多等待
  5 秒），本身**不是**造成今天延遲的原因（今天延遲是自然到達延遲，我方在完全沒有重呼叫
  `/session/set-account` 的情況下，深夜複測仍持續觀察到新成交陸續回填），但如果日後要
  加速「補齊已延遲成交」的可見度，重打一次 `POST /session/set-account`（同帳號，非
  重啟服務、非取消/修改在途單）是一個現成、安全、SDK 原生支援的動作，可作為未來
  「手動催回報」的操作手段記錄下來。
- gateway.stdout.log 對客製化 `logger.info("... SIM accepted ...")` 字串在部分工具
  （PowerShell `Select-String` 全檔掃描）查詢下出現對不上的計數異常（Select-String
  回報 0 筆但 `-Tail` 直接讀取明明看得到），懷疑是該檔案裡混有 Login.log 同款的
  base64/二進位垃圾內容（TokenManager 握手訊息，見稍早偵錯截斷字串）干擾了
  PowerShell 對整檔的行边界解析；不影響今天的結論（本票關鍵判定全部用直接
  curl `/deals` `/trades` `/events/order/recent` 現況 + `-Tail`/`Get-Content -Skip`
  局部讀取的原始內容佐證，未依賴那次計數異常的查詢）。留給下一輪如果要再挖 log 分析
  用工具時參考，避免被這個「計數是 0 但內容其實在」的假象誤導。

## 修法方案與風險（若 Elva 要指派後續票）

本票結論是「非 gateway 連線/撮合缺陷」，因此**不建議**任何 env/registry 級熱修（沒有
可修的連線層問題）。真正該開的後續票是**應用層**（S1/V5-1/V3-4 sim-runner 的
`settlement_confirmed` 輪詢邏輯）：
- 現況：送單後 tick 內輪詢 `3×1.5s`=4.5 秒即放棄，且不寫 `unified_orders` 表
- 建議方向：拉長輪詢視窗至分鐘級，或改為異步/排程重試（比照既有
  `syncKgiUnifiedOrders`/UTA-C2 補輪詢 cron 的模式），或直接讓這三條管線也寫入
  `unified_orders` 表沾上既有補輪詢機制
- 風險：這是**下單管線程式碼**的修改（非本票唯讀診斷範圍），需要 Elva 另案明示派工；
  不涉及真金路徑（三條管線皆為 SIM_ONLY），不需要重啟 gateway 服務，風險面小

## 驗收自查

- [x] 三選一結論＋log 原文證據（關鍵行摘錄）— 見上（A/B 反證，C 成立且具體到應用層
      輪詢逾時）
- [x] 若 A/C：修法方案＋風險 — 見上「修法方案與風險」；本票判定無 gateway 層修法必要
- [x] 報告落檔 `reports/sim_go_live_20260723/VISIBILITY_DIAGNOSIS_20260723.md`

## 查證方法備忘（給複查用）

1. AWS SSM `send-command`（`AWS-RunPowerShellScript`）對 `i-03762861d4ce08932`
   （ap-east-2）讀取 `C:\kgi-gateway-logs\gateway.stdout.log`／`gateway.stderr.log`
   （`Get-Content -Tail`／`-Skip`／`Select-String`）
2. `C:\Python311\Lib\site-packages\kgisuperpy\log\20260723\{Login,Quote,Data}.log`
   （SDK 自帶逐日 log 目錄，無獨立 `Trade.log`——正常，該 SDK 版本本就沒有這個檔名）
3. `C:\Python311\Lib\site-packages\kgisuperpy\pushClient\pyTradeCom.py`／
   `kgisuperpy\trading\Order.py`／`CA.py`（唯讀，`KGI_SUPERPY_VERIFY` 本地副本，
   非 gateway 主機上的正式安裝，程式邏輯應一致但版本號未逐行比對）源碼確認
   `get_trades(full=True)` 空狀態文件語意、`_OnOrderReport`/`_OnExecReport` 觸發條件、
   `_update()`/`ReceiveSReport()` 呼叫鏈
4. 現場複測：`Invoke-WebRequest http://127.0.0.1:8787/{deals,trades,events/order/recent}`
   （gateway 本機 loopback，非 W6 稽核檔、非 `simulation:false`、未取消/修改任何在途單）
