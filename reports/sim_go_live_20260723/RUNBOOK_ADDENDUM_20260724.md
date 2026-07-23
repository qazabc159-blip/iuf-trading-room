# 7/24 殘量補送 RUNBOOK addendum（Jason，2026-07-23 夜備妥）

依 Athena 判定書（`IUF_SHARED_CONTRACTS/lab_verdict_three_sleeve_first_execution_day_2026_07_23_v1.md`）
建議 #1：「殘量補送：未成 22 檔＋部分缺口，7/24 開盤以可成交限價補到位」。本檔案是明早的執行手冊，
工具已備妥＋dry-run 通過。**明早 09:00 ACK 後才 `--send`，本檔不含自動排程。**

---

## 0. 殘量清單來源與範圍界定

殘量清單由 `resend_residual_20260724.mjs` 從**本 repo 自己的 ground truth** 直接計算（
`evidence/orders_20260723.jsonl` + `evidence/reconcile_53_orders_20260723.json`），**不是**
Athena 判定書裡的「22 MISS」原始計數——後者的口徑似乎涵蓋原 70 單計畫裡的 17 檔結構性跳過（高價股
不足一張），而本工具的 53 單送出從未嘗試過那 17 檔，**依派工指示「結構性跳過維持跳過」，不在本次
殘量清單內**。

本工具算出的殘量：**21 筆／合計 68 張**（11 miss_unfilled ＋ 7 partial_gap ＋ 3 rejected_retry）。
另有 **1 筆排除、需人工決定**：`v51_c3/1808`（今日同 symbol 送兩次，終版 KGI 訂單簿只查得到一筆
對應記錄，無法判斷這筆獨立送單究竟成交與否——見
`RECONCILE_53_ORDERS_FINAL_20260723.md` 的 AMBIGUOUS 段落）。**若要處理 1808 殘量，需楊董/Elva
先看過今日 1808 持倉真實累計量再決定要不要補，本工具不自動猜測。**

完整清單（含每檔 last_close／marketable 定價預覽）：`evidence/residual_plan_dry_run_<ts>.json`（
今晚 dry-run 產出，21 筆／68 張，逐筆列在下方表格）。

| sleeve | symbol | 原因 | 原送(張) | 殘量(張) | 7/22收盤價 | phase1 marketable 定價(+1%) |
|---|---|---|---|---|---|---|
| v51_c1 | 1808 | partial_gap | 3 | 2 | 31.95 | 32.3 |
| v51_c1 | 6219 | miss_unfilled | 7 | 7 | 14.25 | 14.4 |
| v51_c1 | 6177 | miss_unfilled | 2 | 2 | 48.3 | 48.8 |
| v51_c1 | 8937 | partial_gap | 4 | 3 | 24.75 | 25 |
| v51_c1 | 4113 | miss_unfilled | 6 | 6 | 14.85 | 15 |
| v51_c1 | 1271 | rejected_retry | 1 | 1 | 62 | 62.7 |
| v51_c1 | 2101 | miss_unfilled | 2 | 2 | 33.6 | 33.95 |
| v51_c3 | 6026 | miss_unfilled | 6 | 6 | 14.6 | 14.75 |
| v51_c3 | 4513 | partial_gap | 4 | 3 | 22.8 | 23.05 |
| v51_c3 | 6885 | miss_unfilled | 4 | 4 | 20.85 | 21.1 |
| v51_c3 | 2465 | miss_unfilled | 1 | 1 | 82.5 | 83.4 |
| v51_c3 | 8171 | partial_gap | 4 | 3 | 20.9 | 21.15 |
| v51_c3 | 4416 | miss_unfilled | 9 | 9 | 10.3 | 10.45 |
| v51_c3 | 2442 | partial_gap | 5 | 4 | 19.4 | 19.6 |
| v51_c3 | 8047 | partial_gap | 2 | 1 | 43.3 | 43.75 |
| v51_c3 | 8059 | miss_unfilled | 6 | 6 | 15.9 | 16.1 |
| v51_c3 | 5267 | rejected_retry | 2 | 2 | 47.1 | 47.6 |
| v51_c3 | 6808 | rejected_retry | 2 | 2 | 40.1 | 40.55 |
| v34_c3_proxy | 2887 | miss_unfilled | 2 | 2 | 35.15 | 35.55 |
| v34_c3_proxy | 2892 | partial_gap | 2 | 1 | 33.95 | 34.3 |
| v34_c3_proxy | 6505 | miss_unfilled | 1 | 1 | 77.7 | 78.5 |

⚠️ 表格 `7/22收盤價` 欄位是**今晚**跑 dry-run 用的 `refdata.json`（7/22 收盤，尚未刷新）——**明早
真送前必先刷新成 7/23 收盤價**（見下方步驟 1），marketable 定價欄位屆時會用新價重算，此表僅供今晚
規模/覆蓋率預覽，**不是明早實際送單價**。

---

## 1. 明早步驟（台北時間）

### 08:20-08:55 開機檢查 + refdata 刷新

```bash
cd "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\reports\sim_go_live_20260723"
curl -s http://43.213.204.233:8787/health
node fetch_refdata.mjs      # 刷新成 7/23 收盤價（今晚的 7/22 版本對明早定價是錯的 PIT）
```

### 08:55-09:00 目視覆核殘量計畫

```bash
node resend_residual_20260724.mjs      # dry-run，確認 21 筆／68 張 marketable 定價用的是新收盤價
```

目視核對：定價欄位應反映**新**的 7/23 收盤（不是本表格的 7/22 舊值），21 筆數量不變（除非楊董/Elva
先對 1808 做了決定並改了工具）。

### 09:00 phase 1 — 初始 marketable 送單

```bash
node resend_residual_20260724.mjs --send
```

- 每筆用 `last_close × 1.01`（tick-aware 無條件進位，上限為漲停 +10%）當限價，**不是** 7/23 工具用的
  `price:null`（Athena 判定＝這正是 7/23 未追價失敗的根因）。
- 冪等：中斷後重跑同指令，已 accepted 的 (sleeve,symbol,phase1) 自動跳過。
- 連 5 敗自動 HARD STOP，不硬送。

### 09:30+ phase 2 — 未成追價 fail-safe（Athena 判定書指名的追價協議）

```bash
node resend_residual_20260724.mjs --requote
```

- 只對 phase 1 送出後**仍零成交**的訂單追價（`+3%`），phase 1 已有任何成交（含部分）的**不追價**（
  見下方「已知限制」——gateway 無法取消/改單，追價是另開一張新單疊上去，为控制重複成交風險，只對
  零成交的追）。
- 同樣冪等＋連5敗停。

### 送完驗證

```bash
curl -s "http://43.213.204.233:8787/trades?full=true" > evidence/trades_manual_0724.json
curl -s "http://43.213.204.233:8787/deals"            > evidence/deals_manual_0724.json
```

---

## 2. 已知限制（誠實列出，非本輪解決）

1. **無法取消/改單** — `kgi-gateway-client.ts` 的 `cancelOrder()`/`updateOrder()` 在 W1 gateway
   都回 `KgiGatewayNotEnabledError`（未啟用）。phase 2 追價不是「改價重掛」，是**疊加一張新單**在
   phase 1 仍掛著的舊單之上——若 phase 1 的舊單後來意外也成交，會造成重複成交（雙倍部位）。已用
   「只追零成交的殘量」降低風險，但**不是保證**。
2. **1808 殘量人工決定** — 見上方第 0 節，本工具刻意不自動猜測。
3. **audit_logs 落點** — 本次殘量補送若要接上 audit_logs，需另外跑
   `apps/api/src/sim-go-live-audit-backfill-20260723.ts`（同批次任務 A 交付的工具）的等價擴充，
   **本輪未做**（7/24 殘量的 audit_logs 落點留待下一輪視需要處理，不阻塞明早送單本身）。
4. **marketable 定價是估算，非真實 orderbook 深度** — refdata.json 只有收盤價+ADV60，沒有即時
   買賣價/深度；`+1%`/`+3%` buffer 是保守經驗值，不保證一定成交（尤其流動性差的名字）。

---

## 3. 檔案清單

| 檔 | 用途 |
|---|---|
| `resend_residual_20260724.mjs` | 殘量補送工具（dry-run 預設／`--send` phase1／`--requote` phase2） |
| `evidence/residual_plan_dry_run_<ts>.json` | 今晚 dry-run 產出的完整殘量計畫（機器可讀） |
| `evidence/orders_20260724_residual.jsonl` | 明早送單後才會產生（冪等 log，phase1/phase2 各自記錄） |

---
Jason（backend strategy engineer）／2026-07-23 夜備妥，2026-07-24 09:00 起由當值 agent 依此執行。
