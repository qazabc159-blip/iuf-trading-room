# S1/V34/V51 SIM Runner qty 單位修復（1000x bug）— 2026-07-23

派工：Elva 明示，接續 `VISIBILITY_DIAGNOSIS_20260723.md` 的 P0 診斷，PR #1345
（`fix/sim-runner-qty-and-reconcile-jason-20260723`）。

## 根因

`s1-sim-runner.ts`／`v34-sim-runner.ts`／`v51-sim-basket-runner.ts` 三條 SIM 下單
管線，對非零股（board-lot）委託，直接把 `entry.target_shares`（股數）當
`createOrder({ qty })` 的值送出。但 KGI SDK `api.Order.create_order()` 的
`qty` 參數，對非零股單位是「張」（1 張 = 1000 股），對零股（odd-lot）單位才是
「股」——docstring 原文：`qty: int, # 張數 (整股) 或股數 (零股)`（
`KGI_SUPERPY_VERIFY/evidence_2026-04-23/step4_account_probe_v2.log` L140-155）。
三條管線的委託因此是 SDK 預期值的 1000 倍。

## 實彈證據（2026-07-23 三 sleeve go-live）

`send_three_sleeve.mjs`（獨立診斷工具，非受影響的正式 runner）本身已正確送
`qty = shares / 1000`：
- symbol 6901：送 `qty=5`（張），真實股數 5000 → 成交回報 `quantity:5`（張）
  @ 19.25（`reports/sim_go_live_20260723/evidence/deals_snapshot_*.json`）
- symbol 1808（order `Y001R`）：送 `qty=3`（張），真實股數 3000 → 成交回報
  `quantity:1`（張，部分成交 1/3）@ 35.1

## 修法

新增 `apps/api/src/broker/kgi-contract-rules.ts::toKgiOrderQty(shares, isOddLot)`
當唯一送單側轉換點：
```ts
export function toKgiOrderQty(shares: number, isOddLot: boolean): number {
  if (isOddLot) return shares;
  return Math.floor(shares / BOARD_LOT_REGULAR);
}
```
三條 runner 的 `createOrder({ qty: ... })` 呼叫點都改走這個函式：
- S1／V51：永遠 `oddLot: false`，固定呼叫 `toKgiOrderQty(shares, false)`
- V34：依 `entry.isOddLot` 呼叫 `toKgiOrderQty(entry.targetShares, entry.isOddLot)`

`audit_logs` 的 `shares`/`target_shares` 欄位語意不變（仍是真股數，PnL/notional
計算不受影響）——只有送去 KGI 的 wire `qty` 改變。

## Round 2（Pete review PR #1345，2026-07-23 同日）— 回報解析層對稱修

Pete 審查發現：送單層修好之後，**回報解析層**（`kgi-order-reconciliation.ts`
的 `normalizeEvidence()`/`reconcileKgiOrder()`）沒有對稱處理——board-lot 成交
的 wire `quantity`（張）被直接當股數，跟 `order.requestedQty`（股）比較/加總，
導致 `filledQty` 少算 1000 倍、`status` 卡在 `partially_filled` 而非
`filled`，且錯值寫回 audit_logs 後因為 status 已離開 `"unconfirmed"` 集合，
補確認 cron 的 filter 會永久跳過它、不可自癒。

修法：新增對稱的 `fromKgiOrderQty(wireQty, isOddLot)`（`kgi-contract-rules.ts`），
`reconcileKgiOrder()` 內所有從 evidence 讀出的數量欄位（`filledQty`／
`requestedQty`／`remainingQty`）在跟 `order.requestedQty`（股）比較/加總前，
先經過這個函式轉回股數；`sameRequest()`（無 tradeId 時的 symbol+side+qty 
fallback 比對）同步修正。新增 `SubmittedKgiOrder.wireQtyUnit?: "lots"|"shares"`
（預設 `"shares"`=不轉換，保留任何未更新呼叫點——如鎖檔 `kgi-sim-env.ts`、
`syncKgiUnifiedOrders`——的既有行為不變）；三條 runner 自己的呼叫點與
`server.ts` 的兩個即時顯示端點（`/api/v1/kgi/sim/orders`、
`/api/v1/kgi/sim/v34-orders`）都明確傳入正確的 `wireQtyUnit`。

## 驗證

- `apps/api/src/broker/kgi-contract-rules.test.ts`：`toKgiOrderQty`/
  `fromKgiOrderQty` 雙向互逆性、真實生產數字（5000 股↔5 張、3000 股↔3 張）、
  odd-lot 直通、零股邊界
- `apps/api/src/broker/kgi-order-reconciliation.test.ts`：全用真實生產股數
  （非 wire 張數）當 fixture，涵蓋 board-lot 全額成交（6901）、board-lot 真實
  部分成交（1808/`Y001R`，1000/3000 股）、odd-lot 成交、Pete 原始 repro 案例
  逐字釘死
- 詳見各檔案內 code comment 與 PR #1345 review thread
