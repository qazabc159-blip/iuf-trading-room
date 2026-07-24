# FORENSICS — trade_id 格式疑雲 + INVALID 四檔根因（8/11 真金前置調查）

**調查者**: Jason-2（backend strategy lane，唯讀鑑識，0 code change）
**時間**: 2026-07-24 15:5x TST
**方法**: origin/main 唯讀 checkout（本機主樹有 lane 外 dirty files，未動）+ app.py 讀碼（唯讀，未改）+
evidence JSONL/JSON 全集交叉比對（node script，過程存於 scratchpad，未落 repo）
**範圍**: 純調查，0 code change，0 PR。

---

## 題目 A：trade_id 格式疑雲

### 結論：**支持**「19 位 = gateway/SDK 自產的用戶端關聯碼，非 KGI 真實 broker-assigned 識別碼」

### 判準比對

- **支持證據**：19 位數字結構性拆解為 `<13位ms-epoch><6位批次序號>`，且與同一筆訂單自己
  的 `ts` 欄位（送出時間）在毫秒級對齊 — 這是本輪核心量化證據，見下。
- **否定證據**：無。repo 內找不到 KGI SDK 文件或官方回應樣本佐證 19 位是真實值；
  `services/kgi-gateway/SCHEMA_MAPPING.md` 引用的 `brokerport_golden_2026-04-23.md`
  在 git 全歷史裡查無此檔（從未真的被 commit），該文件本身就是死連結，無法拿來佐證。

### 關鍵數字（附來源）

1. **app.py 沒有任何 ID 生成邏輯** — `services/kgi-gateway/app.py:1339-1361`
   （`create_order` 的 trade_id 擷取段）純粹是 5 個候選 attr
   （`nid`/`trade_id`/`order_id`/`ord_no`/`seqno`，優先序固定）逐一嘗試 →
   dict fallback → `sdk_repr` regex fallback；三段都失敗才回 `None`。**沒有一行會
   合成/生成新 ID**。所以 19 位值必然是 `session.api.Order.create_order(...)`
   回傳物件（`sdk_response`）自帶的某個屬性值，不是 app.py 生的。

2. **兩天 81 筆送單的 trade_id 與同一批真實 KGI nid/order_id/seqno 集合零交集**
   （node 腳本跑
   `reports/sim_go_live_20260723/evidence/{orders_20260723.jsonl,orders_20260724_residual.jsonl}`
   對 `{trades,deals}_*.json` 全部 12 個 evidence 檔）：
   - trade_id 集合：**81 筆，100% 19 位數字**（`orders_20260723.jsonl` 53 筆 +
     `orders_20260724_residual.jsonl` 28 筆）
   - 真實 nid 集合（`trades_*`/`deals_*` 的 `nid`/`seqno` 欄位）：**80 個唯一值，
     100% 是 8 位零填字串**（範圍約 `00005829`–`00006121`，與當日撮合序號量級吻合）
   - 真實 order_id 集合（`trades_*`/`deals_*` 的 `order_id` 欄位）：**70 個唯一值，
     格式為 `Y0001`/`Y001R` 這種字母+4 碼**
   - **交集：trade_id ∩ nid = 0；trade_id ∩ order_id = 0。無一筆重疊。**

3. **19 位數的前 13 位 = 送單當下的 wall-clock ms epoch，誤差 <100ms**（逐筆比對
   `orders_20260724_residual.jsonl` 的 `ts` 欄位與同筆 `trade_id.slice(0,13)`）：
   `1808 ts_ms=1784854749914 trade_id前13碼=1784854749957 delta=+43ms`、
   `6219 delta=+55ms`、`6177 delta=+44ms`、`8937 delta=+40ms`、`4113 delta=+50ms`、
   `1271 delta=+42ms`（其餘 22 筆同款，delta 均 <100ms，量級吻合網路來回延遲）。
   而**同一批 evidence 裡的真實 nid（`00006099`→`00006121`）跟送單時間毫無關聯**——
   純粹是撮合序列小整數，不可能跟 wall-clock 時間戳有這種毫秒級相關性。這是本輪最
   關鍵的單一證據：一組 ID 跟時間強相關、一組完全不相關，兩者不可能是同一個命名
   空間。

4. **19 位數尾 6 碼是「批次前綴 3 碼 + 單筆計數器 3 碼」的疊加型態**（跨兩天四個批次
   逐筆核對，`reports/sim_go_live_20260723/evidence/orders_20260723.jsonl` +
   `orders_20260724_residual.jsonl`）：7/23 手動 canary 單（row1）尾碼
   `387001`；7/23 主批次尾碼 `732002`→`732052`（52 筆連續遞增，前綴不變）；7/24
   phase1 尾碼 `202001`→`202013`（前 13 筆）在第 14 筆突然切成 `365014`（前綴變、
   但計數器接續不重置）；7/24 phase2 尾碼 `198022`→`198028`（接續全域計數，前綴又
   換）。這種「前綴隨批次/連線切換、計數器持續遞增」的行為，是典型的用戶端本地生
   成識別碼特徵（例如 process/session 相關的隨機或固定前綴 + 遞增序號），跟 KGI
   官方 8 位零填遞增序號（單日內 `00005829`→`00006121`，穩定遞增、無前綴切換）在
   結構上完全不同款。

5. **連 KGI 明確判定「無效單」被拒的 8 筆訂單，也照樣拿到格式完整的 19 位
   trade_id、HTTP 200、`status:"accepted"`**（`orders_20260724_residual.jsonl` 逐行
   對照 `evidence/trades_manual_0724.json` 的「無效單」桶 — 見題目 B 详列，8 筆
   symbol=1271/5267/6808×2+6505×2 全部如此）。這進一步證明：這個值在 SDK 呼叫
   *當下*（尚未確定訂單是否被撮合引擎接受）就已經存在——真正的 broker-assigned nid
   只在訂單被實際處理後才會產生（無效單的真實 nid 是 `00006099` 這種，出現在
   `trades_manual_0724.json` 的 `operations[].nid`，但從未出現在對應的
   `orders_20260724_residual.jsonl` `trade_id` 欄位），跟被讀到的 19 位值是兩件事。

### Steelman（反方最強論點）

無法 100% 排除「這 19 位是 KGI SDK 自己合法暴露的用戶端關聯 `seqno`（許多券商 SDK
會在收到真正 broker nid 之前，先給呼叫端一個本地生成的關聯碼，方便非同步對帳）」——
即便如此，這個值仍然**跟 `/trades`/`/deals`/`/events` 回傳的任何欄位都在不同命名空
間**（上面第 2 點的零交集是鐵證），所以不管它「合不合法」，**`reconcileKgiOrder()`
的 `idMatches` 快速比對路徑在實務上永遠不會命中**，結論不受影響。唯一沒查證到的是
「究竟是哪個 SDK 屬性名（`seqno`/`trade_id`/`order_id`/`ord_no`）被讀到」——因為沒有
任何 evidence 檔案持久化過原始 `kgi_response_repr` 文字（`OrderCreateResponse` 有這
個欄位但沒人存過），這件事需要下次開盤即時 curl 才能補上，本輪唯讀無法補。

### 對 reconcileKgiOrder() 的實務衝擊（Pete 升級的風險，本輪確認成立）

`apps/api/src/broker/kgi-order-reconciliation.ts:178`
（`idMatches = tradeId ? evidence.filter((row) => row.tradeId === tradeId) : []`）
對**真 runner**同樣失效——不只是 ad-hoc 工具。理由：

- `apps/api/src/broker/kgi-broker-adapter.ts:73-79`
  的 comment 明講：`submitOrder()` 用 `extractKgiTradeId()`，「matching the
  extraction already proven correct in kgi-sim-env.ts's runSimTradeSmoke()」——
  跟 ad-hoc 工具讀同一個 gateway response 形狀。
- `apps/api/src/s1-sim-runner.ts:878-881`（真 S1 runner）也是直接
  `extractKgiTradeId(tradeRecord["trade_id"]) ?? ... ?? extractKgiTradeId(tradeRecord)`
  ——跟 ad-hoc 工具（`resend_residual_20260724.mjs:382`
  `res.body.trade_id ?? res.body.broker_order_id`）讀的是同一個 app.py 回應欄位、
  同一段 app.py 擷取邏輯（`app.py:1339-1361`）。
- 所以真 runner 拿到的 tradeId 也會是這種 19 位格式，對 `/trades`/`/deals`/`/events`
  回傳的真實 nid/order_id 永遠比不到 → `idMatches` 恆空 → `matchStrategy` 只能退到
  `exact_request`（symbol+side+qty 啟發式），這條路徑本身沒錯但比 ID 精確比對脆弱
  （`resend_residual_20260724.mjs` 檔頭註解自己也點名 1808 v51_c3 那個「同 symbol 兩
  筆訂單分不清是哪筆成交」的已知模糊案例，正是這個弱點的具體案例）。

### 意外發現（本輪最重要的新發現，超出題目 A/B 原題範圍）

**`app.py` Gate 3（`app.py:1263-1372`）從不檢查 `sdk_response` 內部是否代表「被
KGI 拒絕」——只要 SDK 呼叫沒有 `raise` exception，就無條件回 HTTP 200
`ok:true status:"accepted"`。** 這件事在題目 B 的 8 筆「無效單」上被直接證實：
`orders_20260724_residual.jsonl` 對這 8 筆全部記錄 `"status":"accepted"`,
`"http_status":200`，但 `trades_manual_0724.json` 的「無效單」桶顯示這 8 筆
`order_id="0000"`、`quantity=0`、KGI 的 `operations[].status="Failed"`，帶明確錯誤
訊息（MAT0015/MAT0024，見題目 B）。這代表：

- ad-hoc 工具的 `submitPhase()`（`resend_residual_20260724.mjs:376-388`）判斷
  `accepted` 只看 HTTP 200 + `res.body.ok===true`，對這種「SDK 沒拋例外但 KGI 內部
  已拒單」的情境完全誤判。
- **真 runner 走同一段 app.py Gate 3**（`s1-sim-runner.ts:883`
  `accepted = true; ... console.log(...accepted tradeId=...)` 同樣只看 HTTP
  層是否成功），代表真 runner 對「KGI 同步拒單」也一樣會誤判成 `accepted`，只有
  後續 3 次×1.5s 輪詢 `/trades`/`/deals`/`/events` 能不能撈到證據才會發現——而根據
  2026-07-22 RCA（`.claude/agent-memory/backend-strategy-jason/
  pattern_kgi_sim_send_chain_rca_20260722.md`），這個輪詢窗口過去 8+ 週歷史上
  `settlement_confirmed:true` 出現次數是 **0**。也就是說：真 runner 目前完全沒有
  可靠機制能在合理時間內發現「KGI 同步拒單」這件事，本輪找到的 8 筆無效單全靠
  Jason/Elva 事後手動查 `/trades` 才抓到。

---

## 題目 B：INVALID 四檔根因

### 結論：**駁斥「四檔同因」的派工前提** — 實際是兩組不同根因，需分開結論

`evidence/trades_manual_0724.json` 的「無效單」桶（8 筆，兩天各嘗試一次）逐筆列出
KGI 回傳的真實錯誤代碼：

| symbol | sleeve | 錯誤代碼 | 錯誤文字 | 出現次數 |
|---|---|---|---|---|
| 1271 | v51_c1 | **MAT0015** | 股票代號錯誤 | phase1+phase2 各 1 次 |
| 5267 | v51_c3 | **MAT0015** | 股票代號錯誤 | phase1+phase2 各 1 次 |
| 6808 | v51_c3 | **MAT0015** | 股票代號錯誤 | phase1+phase2 各 1 次 |
| 6505 | v34_c3_proxy | **MAT0024** | 委託價超過當日漲跌範圍 | phase1+phase2 各 1 次 |

派工原題的「order_id="0000"／qty 強制 0／無理由欄位」只是**表面共同症狀**（KGI 把任
何拒絕都塞進同一個回應形狀），底層是兩種完全不同的機制。

### 子結論 1：1271 / 5267 / 6808 —— **支持①/④**（symbol 不在 KGI SIM 可交易清單）

- 判準對照：MAT0015「股票代號錯誤」是 KGI 端**對股票代碼本身的拒絕**，不是價格
  （②）或數量（③）規則——錯誤文字本身就直接排除②③，不需要再驗算 tick/qty。
- 三檔都是**策略籃子裡真實存在的標的**，不是烏龍/打錯字：1271 在
  `data/lab/sim_baskets/v51_sim_basket_2026-07-13.csv:23`；5267、6808 在
  `reports/sim_go_live_20260723/baskets/v51_c3_sim_basket_2026-07-13_backfill.csv`
  （分別在第 24、27 行附近）。
- 排除 client 端規則問題：`apps/api/src/broker/kgi-contract-rules.ts` 全檔讀過，只有
  board-lot/tick-size/min-qty/position-type/market 正規化四類推算表，**沒有任何
  symbol 白名單/黑名單邏輯**，且這幾個常數表根本沒被 `resend_residual_20260724.mjs`
  引用（該腳本自己內嵌一份獨立的 tick table）——排除 TS 側規則造成 MAT0015 的可能。
- **細部子因（哪一種：新股上市滯後 / 上櫃路由 / 處置警示股）本輪判定「資料不足」**
  ——需要 KGI itradetest SIM 環境當週的可交易 symbol master 或開盤時段即時查證，
  唯讀鑑識無法在本輪確認，留給下一步。

### 子結論 2：6505 —— **支持「工具資料管線 stale reference price」**，非四檔框架內任一項

- `reports/sim_go_live_20260723/refdata.json` 裡 6505 的條目跟其他 53 檔明顯不同源：
  ```
  6505: last_close=77.7  last_close_date="2026-07-20"  source="v34_csv_wm60"  n_days=null
  其餘(如1271/5267/6808/1808): last_close_date="2026-07-23"  source="finmind_taiwanstockprice"  n_days=60
  ```
  即 6505 用的參考價是**送單當天往前推 3 個交易日（跨過週末）**的舊收盤，其他都是
  T-1（新鮮）收盤。
- 根源找到：`reports/sim_go_live_20260723/baskets/v34_sim_shakedown_basket_2026-07-21_v2.csv`
  這份 6505 所屬的 CSV 本身內嵌了一欄 `last_close=77.7`（`signal_date=2026-07-20`），
  而 `resend_residual_20260724.mjs`／refdata 建置流程對 v34_c3_proxy sleeve 直接信任
  CSV 自帶的這個舊欄位，沒有像其他 sleeve 一樣重新打 FinMind 拿新鮮收盤。
- `resend_residual_20260724.mjs` 的 `marketablePrice()` 用這個 3 天舊的 77.7 算出
  phase1 價 78.5（+1% buffer）、phase2 價 80.1（+3% buffer），tick 對齊本身沒問題
  （78.5、80.1 都精確落在 [50,100) 級距的 0.1 tick 上，排除 tick 計算 bug）——問題是
  這兩個價格是相對「3 天前的收盤」算出來的，若 6505 這 3 個交易日內真實價格已經
  走離，KGI 用**當下真實前一日收盤**算出的漲跌停範圍跟我們算的完全脫鉤，MAT0024
  正是這個脫鉤的直接證據。
- 這是**本輪三選一的「支持」結論**，但支持的是一個新命題（工具腳本 refdata 拼裝時
  混用了不同新鮮度的 source），不是派工預先註冊的①②③④裡任何一項的字面對應——
  最貼近②（檔位/tick 規則），但根因不是 tick 表算錯，是「餵進 tick 計算的參考價本
  身是舊的」。

### Steelman（反方最強論點）

- 1271/5267/6808：也可能不是「symbol 未收錄」，而是這三檔剛好在 KGI itradetest SIM
  環境當下處於某種帳戶層級或環境層級的臨時限制（例如該測試環境當天維護中排除了這
  幾檔），而非永久性排除——本輪查不到 KGI 官方文件能區分「永久不可交易」vs「當週臨
  時限制」，兩者都會產生同一句 MAT0015，資料不足以再細分。
- 6505：也可能不是純粹「舊收盤價」造成，而是 6505 本身在 7/24 當天股價出現了大幅
  跳空/處置降低漲跌幅限制等其他因素同時存在，放大了舊收盤造成的偏差——但即便如
  此，「refdata 對這一檔用了舊收盤」本身是可獨立驗證且已確認的事實，不受這個
  steelman 影響。

---

## 綜合建議下一步

### Topic A
1. **不改碼優先**：8/11 前找一次真開盤即時窗口，在 gateway 端臨時加一行 debug log
   （或用既有 `kgi_response_repr` 欄位）把 `sdk_response` 原始 repr 存進某個
   evidence 檔案一次，一次性坐實 19 位值到底來自 SDK 的哪個屬性名。這不用碰鎖檔
   邏輯本身，只是多存一次現有欄位。
2. **要改碼的部分屬於鎖檔區**（`services/kgi-gateway/app.py`），需楊董/Elva 明示才
   能開；建議方向是 Gate 3 判定「accepted」時應該檢查 `sdk_response` 本身有沒有
   拒絕/失敗訊號（見下方「意外發現」的建議），而不是動 TS 側 —— TS 側
   `reconcileKgiOrder()` 的 `exact_request` fallback 目前語意正確，可以先靠它撐著。

### Topic B
1. 1271/5267/6808 建議 Lab（Athena）從下一輪基礎池排除，直到能在開盤時段用即時
   KGI SIM 查證是否真的永久不可交易。
2. 6505 屬工具腳本資料管線 bug（`v34_sim_shakedown_basket_2026-07-21_v2.csv` 內嵌
   舊 `last_close` 欄位被信任），不是策略或 broker adapter 問題——若還要用
   `resend_residual*` 系工具，該欄位應該統一走跟其他 sleeve 一樣的
   `finmind_taiwanstockprice` 即時刷新，不要信任 CSV 自帶的歷史欄位。這屬於報告腳
   本本身（`reports/sim_go_live_20260723/`），不算鎖檔，backend lane 下次派工可直
   接改。

### 🔴 Cross-cutting（本輪意外發現，建議獨立列為 8/11 前 P0 待辦，優先度高於上述兩項）
`app.py` Gate 3 把「SDK 呼叫沒有拋例外」等同於「KGI 接受了這筆單」，導致**同步拒單
會被誤報成 accepted（HTTP 200）**——這件事影響的不只是 ad-hoc 工具的紀錄品質，
真 runner（`s1-sim-runner.ts` 等）走同一段 gateway 邏輯，一樣會把同步拒單誤判成
`accepted`，且過去 8+ 週的非同步輪詢對帳機制對這類單子 100% 沒能抓到
（見 2026-07-22 RCA）。這是本輪查證過程中發現、比原題目 A/B 都更立即可能影響 8/11
真金驗收判讀的缺口，建議 Elva 優先排這個而非只處理已註冊的兩題。

---

## 失敗/未達成事項（誠實列出，四項齊）

1. **無法直接讀取 kgisuperpy SDK 原始碼**——proprietary SDK 不在本 repo（EC2 gateway
   host 上另外安裝），所以無法 100% 確認 19 位值對應的確切 SDK 屬性名稱（`nid` vs
   `seqno` vs 其他），只能靠格式/時間相關性間接證明它不是真實 broker nid。
2. **無法即時查 KGI itradetest SIM 的 symbol master**——今天（7/24）市場已收盤
   （EventBridge 08:20-14:10 TST gateway 排程窗口已過），只能靠歷史 evidence 檔案
   做鑑識，無法對 1271/5267/6808 的具體「未收錄原因」做即時查證。
3. **無法取得 6505 7/23 當日的真實收盤價做精確反算**——本環境是獨立的虛構市場數據
   （非真實 TWSE），沒有可信的外部資料源可以拿到「當時 KGI 真正用來算漲跌停的
   前一日收盤」，只能證明「我方用的參考價確實比其他 sleeve 舊 3 個交易日」這個結構
   性事實，無法精確算出偏差百分比。
4. **未持久化 `kgi_response_repr` 原始文字**——所有 evidence 檔案都只存了已解析的
   `trade_id` 欄位，從未有人存過 `OrderCreateResponse` 完整 repr，本可以一次性解決
   題目 A 的 steelman 缺口，但本輪未曾捕捉過，只能留給下次開盤時段。
