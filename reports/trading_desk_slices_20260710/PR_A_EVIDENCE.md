# PR-A 委託回報面板 — 驗收證據 (2026-07-10)

Branch: `feat/order-status-strip-jim-20260710` / PR #1206 (DRAFT)

## 真 owner session 對 prod API
```
POST https://api.eycvector.com/auth/login {"email":"qazabc159@gmail.com",...} -> 200 (Owner)
GET  https://api.eycvector.com/api/v1/uta/orders?limit=20 -> 200 {"data":{"orders":[]}}
```
盤中（2026-07-10 週五 11:xx 台北，非休市日）實測，今日尚無跨券商委託 — 空狀態為真實資料，非模擬。

## Playwright frameLocator 真瀏覽器驗
本機 dev server（此分支未合併程式碼）+ 真 owner session storageState + 真 prod API：
```
IUF_QA_WEB_BASE_URL=http://localhost:3000 IUF_QA_API_BASE_URL=https://api.eycvector.com \
  npx playwright test jim_uta_orders_report_20260710.spec.ts --project=desktop-chromium
```
結果：2 passed（auth.setup + 委託回報 tab 測試）。斷言涵蓋：
- `.lhead .tb[data-lt="uta-orders"]` tab 存在且顯示「委託回報」
- SSR 佔位「委託回報載入中…」在 client 15s 刷新後被換掉
- `#uta-orders-body` 顯示誠實空狀態「今日無委託」或四態中文標籤，不含裸露 enum（pending/submitted/... 皆不出現在渲染文字中）

截圖：`PR-A_uta_orders_report_empty_state_20260710.png`（委託回報 tab 已點開，顯示「今日無委託」；表頭：時間/標的/通道/方向/數量/委託價/狀態）。

Spec 檔（新增，非既有 CI P0 套件成員）：`packages/qa-playwright/tests/jim_uta_orders_report_20260710.spec.ts`

## 非空渲染路徑
未在 prod 抓到今日非空委託（誠實回報，非迴避）。已用 vitest 對 hydration script 的 render 邏輯做 source-substring 覆蓋（四態 label map、通道 label、狀態 class 映射），詳見 `apps/web/lib/final-v031-paper-ticket.test.ts` 新增的 2 個 it block；`apps/web/lib/paper-orders-api.test.ts` 對 `listUnifiedOrders()` 用 mock fetch 驗證非空 fixture 正確解析（1 筆 kgi/submitted 委託）。

## 綠燈
- `pnpm typecheck` 15/15
- `pnpm --filter @iuf-trading-room/web test` 515/515（505 既有 + 10 新增）
- `pnpm run build:web` green
- `packages/qa-playwright` tsc --noEmit green
