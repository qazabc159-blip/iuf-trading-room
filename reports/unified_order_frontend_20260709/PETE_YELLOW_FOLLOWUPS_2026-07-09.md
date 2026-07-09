# PR-3/PR-4 統一下單流 Pete review 🟡 follow-ups — Jim（2026-07-09）

接續 #1193（PR-3）／#1195（PR-4）merge 後 Pete review 留下的 2 個 non-blocking 🟡。

## 🟡 1 — paper submit 缺 accountId 顯式守衛

`apps/web/lib/final-v031-live.ts`：paper 送單 handler（原 `kgiSubmit` 已有守衛，`submit` 沒有）在
`accountIdForBroker("paper", accounts)` 之後，`accountId` 可能因 `/uta/accounts` fetch 失敗而是空字串，
直接送進 `submitUnifiedOrder()`，稽核列會出現 `accountId:""`。補上與 KGI 守衛同形狀的顯式擋：

```
const accountId = accountIdForBroker("paper", accounts);
if (!accountId) {
  const blockedLabel = getSubmitLabel(); if (blockedLabel) blockedLabel.textContent = "紙上單未送出";
  const gate = $(".gate .h .v"); if (gate) gate.textContent = "找不到模擬帳號，請重新整理後再試";
  return;
}
```

文案中文、非工程語意，鏡射既有 KGI 守衛「找不到 KGI 模擬帳號，請重新整理後再試」。

## 🟡 2 — hydrateBrokerStrip 查詢失敗時徽章整個不渲染

`buildPaperPayload()`（`final-v031-live.ts`）新增 `accountsFetchFailed` 旗標，只在 `GET /uta/accounts`
真的失敗（非 2xx 或回傳非陣列）時設為 `true`；成功但空陣列不算失敗。旗標隨 payload 一起序列化進
`window.__IUF_FINAL_V031_LIVE__`。

`hydrateBrokerStrip()` 內的徽章渲染邏輯：找不到對應帳號（`account === null`）時，若
`live.accountsFetchFailed` 為真，顯示灰色「狀態查詢失敗」徽章；旗標為假（代表查詢成功，帳號真的不存在——
理論上 #1165 seeding 後不該發生，但留作保底）則不渲染，維持原行為。有真實帳號時一律用既有
`gatewayBadge(account.gatewayStatus)` 四態，不受這次改動影響。

## 測試

新增 2 個 vitest（`apps/web/lib/final-v031-paper-ticket.test.ts`）：
- 守衛存在性 + 文案 + 與 KGI 守衛並存不互相覆蓋
- `accountsFetchFailed` 旗標存在、傳遞進 payload、`hydrateBrokerStrip` 依旗標渲染查詢失敗徽章、不覆蓋真實 gatewayStatus

沿用本檔既有測試風格（對 `final-v031-live.ts` 原始碼字串斷言，因為這段程式是以 raw template string
注入 `<script>` 的客戶端 hydration code，沒有 bundler import，無法直接單元測試 DOM 行為）。

## 驗證結果
- `pnpm --filter @iuf-trading-room/web test`：60/60 test files, 498/498 tests green（含新增 2 個）
- `pnpm typecheck`：15/15 packages green
- `pnpm run build:web`：green，全部既有 route 正常輸出
- 未跑 Playwright（本輪為靜態文字守衛 + badge 渲染邏輯修正，沿用既有 vitest 覆蓋慣例；PR3/PR4 的
  `jim_pr3_unified_order_20260709.spec.ts` / `jim_pr4_account_strip_20260709.spec.ts` 需真 owner
  session + gateway 窗才能驗證，超出本輪 non-blocking follow-up 範圍）

## 修改檔案
- `apps/web/lib/final-v031-live.ts`
- `apps/web/lib/final-v031-paper-ticket.test.ts`
