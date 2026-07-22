# 三 sleeve SIM go-live 送單 RUNBOOK — 2026-07-23 晨（Elva 親自執行）

楊董直令、Athena SIGNED（bridge：`IUF_SHARED_CONTRACTS/lab_to_tr_three_sleeve_sim_go_live_0723_2026_07_22_v1.md`）。
**全部 SIM（KGI_SIMULATION）。真金路徑不碰**——gateway Gate 2 對 LIVE session 永久 409（`services/kgi-gateway/app.py` L1247-1261）。

本目錄工具由 2026-07-22 夜間準備，dry-run 已用 7/22 真收盤價驗過（`dry_run_20260722.txt`）。

---

## 0. 兩個必讀結論（今晚查證，附代碼證據）

### 0a. qty 單位＝「張」（本工具送張數，與現行 runner 不同——刻意）

- gateway `/order/create` 真 handler 把 `qty` **原樣透傳**給 SDK：`services/kgi-gateway/app.py` L1329-1338（`qty=order_req.qty`，無任何換算；schema `services/kgi-gateway/schemas.py` L184 只驗 int）。
- kgisuperpy SDK 官方 docstring（鐵證）：**`qty : int — 委託張數 or 股數`**——整股（`odd_lot=False`）＝**張數**、零股＝股數。
  出處：`KGI_SUPERPY_VERIFY/evidence_2026-04-23/step4_account_probe_v2.log` L140-155（Big5 原文，7/22 夜解碼確認）＋ `KGI_SUPERPY_VERIFY/brokerport_golden_2026-04-23.md` L74。
- **現行 runner 全部送「股數」**（`apps/api/src/s1-sim-runner.ts` L869 `qty: entry.target_shares`，target_shares 是 floor 到 1000 倍數的股數；`v51-sim-basket-runner.ts` L656 同）。按 SDK docstring 這是 **1000 倍超量下單**。7/14、7/21 的「實證通」只證了傳輸層 accepted（HTTP 200＋trade_id），**零筆 confirmed 成交**（Bruce 7/22 親查：24 筆 S1＋23 筆 V5-1 全 unconfirmed，見 `reports/sim_send_dispute_settle_20260722/SETTLE_SIM_SEND_DISPUTE_2026_07_22.md`），所以不存在成交端反證。
- **本工具送 `qty = 股數/1000 = 張數`**。明早成交回報是單位結論的第一次實彈檢驗：**拿 `/deals` 的成交量同時對「張」「股」兩種解讀**，若成交量是預期的 1000 倍（例如送 3 張卻成交 3000 張），立即停送剩餘批次並回報。

### 0b. Gateway URL

`http://43.213.204.233:8787`（台北 EC2 i-03762861d4ce08932 EIP；7/22 夜 `railway variables --service api` 查得 `KGI_GATEWAY_URL` 現值）。
⚠️ 舊報告 `reports/trading_room/kgi_sim_env_e2e_evidence_v1.md` 裡的 `54.249.139.28` 是已 terminate 的東京機，**不要用**。
Gateway 依 EventBridge 排程平日 **08:20 開機／14:10 關機**——08:20 前打不通是正常。

---

## 1. 已知落差：可送單數 = 53 非 70（需楊董/Elva 知悉）

Bridge 標題「合計 70 張單」，但 bridge 自己凍結的 sizing 規則（`floor(名目×權重÷參考價÷1000)×1000`，不足一張跳過不硬湊零股）在 C1/C3 每檔名目僅 ~10 萬 TWD 下，**17 檔高價股連一張都買不起**（如 6515@6500、8299@1915、7610@1835、5289@1360…完整清單見 `dry_run_20260722.txt` SKIPPED 段）。
- 實際可送：**53 單**（C1 19／C3 26／V3-4 8），合計名目 **4,426,500 TWD**（vs 計畫 7M）。
- 這是規則的必然結果，不是 bug。若楊董要接近 70 單/7M，需 Lab 修 sizing 規則或提高名目（改配置=Lab lane，工具端只要改 `config.json` 的 `notional_twd` 重跑 dry-run 即可）。
- 驗收條件①「70 單送出」在現行凍結規則下**不可能達成**，開盤前先跟 Athena/楊董對齊預期。

參與率護欄（單筆 ≤ 60 日日均成交值 5%）：以 7/22 refdata 計，53 單**全數未觸頂**（最小 ADV60 的 6219 cap≈26.3 萬 > 單筆 9.98 萬）。ADV 缺值會 fail-closed 跳過——本次 54/54 齊全，無此情況。

---

## 2. 明早時間軸（台北時間）

### 08:20–08:55 開機檢查

```bash
cd "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\reports\sim_go_live_20260723"
curl -s http://43.213.204.233:8787/health
```

- 預期 `{"status":"ok","kgi_logged_in":...,"account_set":...}`。
- `kgi_logged_in:false` → 不用手動 login，`--send` 腳本會自動 login（simulation:true）＋ set-account 0012826。
- `kgi_logged_in:true` → 腳本自動跳過 login（gateway 是 singleton session，重複 login 有踢線風險）。
- 08:30 後仍連不通 → EC2 沒開機，查 EventBridge/手動 start instance（AWS 帳號 027903151493，region ap-east-2），連不上就停下回報。

### 08:30–08:55 refdata 與 dry-run 目視

refdata.json 已含 7/22 收盤價（54/54，FinMind 7/22 已出當日盤後資料），**直接可用，不必重抓**。若要刷新（非必要）：`node fetch_refdata.mjs`（FinMind 單線程 500ms 節流，約 1 分鐘；403 立停）。

```bash
node send_three_sleeve.mjs          # dry-run（預設，零網路）
```

目視核對：53 單、三 sleeve 小計、合計 ~4.43M、SKIPPED 17 檔全是 below_one_lot。與 `dry_run_20260722.txt` 一致即可。

### 09:00 起 真送（分三批 = 腳本內建順序 C1→C3→V3-4）

```bash
node send_three_sleeve.mjs --send
```

- 腳本行為：/health → 視需要 login＋set-account → 逐單 POST `/order/create`（間隔 ≥300ms）→ 每單 append `evidence/orders_20260723.jsonl` → 結束後自動存 `/trades` `/deals` snapshot 到 `evidence/`。
- 每單 payload（形狀=7/21 實證通的 shape，唯 qty 改張數）：`{"action":"Buy","symbol":"...","qty":<張>,"price":null,"time_in_force":"ROD","order_cond":"Cash","odd_lot":false,"name":"<sleeve>"}`；`name` 掛 sleeve 標籤（`v51_c1`/`v51_c3`/`v34_c3_proxy`）供對帳。
- **冪等**：中斷後直接重跑同指令，已 accepted 的 (sleeve,symbol) 自動跳過，不會重複下單。
- 若想真的分三批人工把關：跑一次 `--send`，第一個 sleeve 送完目視 evidence JSONL 無異常再讓它繼續（腳本是順序送，Ctrl+C 停止後重跑即從斷點續）。

### 送完立即驗證（盤中）

```bash
curl -s "http://43.213.204.233:8787/trades?full=true" > evidence/trades_manual_0723.json
curl -s "http://43.213.204.233:8787/deals"            > evidence/deals_manual_0723.json
```

檢查：
1. `/trades` 裡出現 53 筆委託，name 帶 sleeve 標籤。
2. **單位檢驗（最重要）**：`/deals` 成交量 vs 送出 qty——成交「N 張/N000 股」＝張數解讀正確；若成交量是送出 qty 的 1000 倍＝單位判斷錯誤，**立停回報**，勿再送任何單。
3. Lab 側 `IUF_KGI_SIM_DealsWatch_0723` 09:45/13:30 會獨立讀 deals；盤後 Lab reconciler 對帳（MISS/UNEXPECTED/DRIFT/OVER_CAP/PARTICIPATION）。

### 盤後

- evidence 目錄整包（orders JSONL＋trades/deals snapshots）commit 進本目錄。
- 成交確認寫 audit_logs/unified_orders 的閉環 debug＝Elva 既排晨診斷工作，非本工具範圍。

---

## 3. 異常分支

| 情況 | 處置 |
|---|---|
| /health 打不通（08:30 後） | EC2 未開機：查 AWS console/EventBridge；start 後等 ~2 分鐘 gateway service 起來再 /health。仍不通 → 停下回報，勿改 gateway 任何檔（W6 稽核唯讀）。 |
| login 失敗（腳本 ABORT） | 看回應 body。憑證=F131331910/0000（SIM）。可能 KGI SIM 端維護——重試一次，仍敗停下回報。**絕不試 simulation:false**。 |
| 單被拒（非連續） | 記錄在 evidence JSONL（status=rejected＋error body），繼續送下一單。盤後彙整回報。 |
| 連續 5 單失敗 | 腳本自動 HARD STOP（exit 3）。**停下回報，不硬送**。診斷後重跑同指令（冪等續傳）。 |
| 成交量疑似 1000 倍 | 立停。這代表 SIM 端把 qty 當股數（與 SDK docstring 相反）——把 /deals 原始 JSON 存證回報，改 `send_three_sleeve.mjs` 的 `qty_lots` 改回股數前需 Elva 確認。 |
| FinMind 403（僅重抓 refdata 時） | 立即全停（腳本內建），用既有 refdata.json（7/22 收盤價 sizing 可接受）。 |

---

## 4. 檔案清單

| 檔 | 用途 |
|---|---|
| `config.json` | gateway URL／帳號／sleeve 定義／名目／護欄參數（改名目改這裡） |
| `baskets/*.csv` | 三籃凍結副本（源：`IUF_QUANT_LAB/research/forward_track/sim_baskets/`，7/22 夜複製） |
| `fetch_refdata.mjs` | FinMind 抓 44 檔 V5-1 收盤價＋60 日均成交值；V3-4 用 CSV 自帶 wm60/last_close |
| `refdata.json` | 7/22 夜實抓結果：54/54 檔齊，全部 7/22 收盤、n=60 |
| `send_three_sleeve.mjs` | 送單工具（dry-run 預設／`--send` 真送／冪等／節流／護欄） |
| `dry_run_20260722.txt` | 7/22 夜 dry-run 存證（53 單，4,426,500 TWD） |
| `evidence/` | 明早送單 JSONL＋trades/deals snapshots 落點 |

## 5. 證據索引（qty 單位＋路徑核對）

- `services/kgi-gateway/app.py` L1221-1384：`/order/create` 3-gate 真 handler；L1329-1338 qty 原樣進 SDK（唯讀檔，未動）
- `services/kgi-gateway/schemas.py` L180-189：CreateOrderRequest（qty:int、odd_lot 預設 False）
- `services/kgi-gateway/app.py` L212-222＋`schemas.py` L249-253：/health 回應形狀（kgi_logged_in／account_set）
- `apps/api/src/broker/kgi-gateway-client.ts` L271-302（login）、L346-360（set-account）、L423-445（createOrder payload 形狀）、L465-498（trades/deals/events）
- `apps/api/src/s1-sim-runner.ts` L815-898（7/21 實證通路徑）、L367-369＋L650-683（target_shares=股數的計算）
- `KGI_SUPERPY_VERIFY/evidence_2026-04-23/step4_account_probe_v2.log` L140-155：SDK create_order signature＋docstring（qty=委託張數 or 股數）
- `reports/sim_send_dispute_settle_20260722/SETTLE_SIM_SEND_DISPUTE_2026_07_22.md`：7/22 Bruce 第三方查證（送單通／零 confirmed）

---
工具製作：TR 執行工具工程師（Fable session）2026-07-22 夜。楊董授權範圍：SIM only；`--send` 由 Elva 明早親自執行。
