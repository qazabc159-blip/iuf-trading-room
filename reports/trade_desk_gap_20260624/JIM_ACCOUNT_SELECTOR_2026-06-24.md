# Jim — 交易台帳號/券商選擇器實作報告
**Date:** 2026-06-24  
**Branch:** `feat/trade-desk-account-selector-20260624`  
**Base:** origin/main c5ed2de2 (#1127)

---

## Step 1 — Plan

### 資料來源決策
- `GET /api/v1/uta/adapters` 回傳 `{data:{adapters:[...]}}` — 用此當可選券商來源
- `/api/v1/uta/accounts` 現為空 → 不依賴它；SIM 通道不需 broker_accounts 連線
- `paper` 為永遠 available 的 built-in 預設
- `kgi` 從 adapters 取，`isActive` 由後端控制
- `fubon` → disabled button，永遠不可選（`isActive=false` on backend）

### 選擇後行為
| 選的券商 | 下單流 | 按鈕文字 |
|---------|--------|---------|
| paper (預設) | paper 流 (`/api/v1/paper/preview` + `/submit`) | 送出模擬訂單 |
| kgi | KGI SIM 流 (`/api/ui-final-v031/backend?path=/api/v1/kgi/sim/order`) | 送出 KGI 模擬單 |

### 持久化
- `localStorage` key: `iuf-active-broker`
- 預設值: `paper`（若 localStorage 讀不到或值為空）

### 硬守事項
- real order 路徑不新增（`prod_write_blocked` 守住）
- 「正式實單仍鎖定」字樣保留在 gate 文字
- 富邦按鈕 `disabled` 屬性不移除、不可選
- 不碰後端 `server.ts / broker/**`

---

## Step 2 — 實作摘要

### 核心變更

#### `apps/web/lib/final-v031-live.ts`

1. **UTA adapters fetch** — `clientPaperPayload()` 中的 `const brokers = []` 換成實際 `apiGet("/api/v1/uta/adapters")` + soft fallback；排除 `fubon`。

2. **新增 helper functions**:
   - `ACTIVE_BROKER_STORAGE_KEY = 'iuf-active-broker'`
   - `activeBrokerKey()` — 讀 localStorage，預設 `paper`
   - `setActiveBroker(key)` — 寫 localStorage
   - `brokerSubmitCopy(brokerKey)` — 根據 active broker 回傳 `{prefix, sub, shortName}`

3. **`hydrateBrokerStrip()` 改寫**:
   - 不再重建 innerHTML（保留 HTML 的 `.bbtn` 結構）
   - 對每個 `.bbtn` 設 `.active` class（依 localStorage 狀態）
   - `fubon` button 永遠跳過（已有 `disabled`）
   - 首次 call 時 wire click handler（`data-brokerClickWired` 防重複）
   - Click → `setActiveBroker()` + `hydrateBrokerStrip()` + `applyBrokerSubmitVisibility()`

4. **新增 `applyBrokerSubmitVisibility()`**:
   - `paper` active → `#submit-btn` 顯示，`#submit-kgi-sim-btn` 隱藏
   - `kgi` active → `#submit-kgi-sim-btn` 顯示，`#submit-btn` 隱藏
   - 同步按鈕前綴文字（`送出模擬訂單` / `送出 KGI 模擬單`）

5. **動態化 KGI submit handler 文字** — 所有 "KGI SIM" 硬編 label text 換成 `activeBrokerCopy.shortName + " ..."`:
   - "KGI SIM 風控預檢中..." → `activeBrokerCopy.shortName + " 風控預檢中..."`
   - "KGI SIM 送單中..." → 同上
   - "KGI SIM 送單失敗" → 同上
   - "KGI SIM #tradeId 已送出" → 同上
   - "KGI SIM 已送出（正式實單仍鎖定）" → `activeBrokerCopy.shortName + " 已送出（正式實單仍鎖定）"`
   - "KGI SIM 未送出" → 同上

#### `apps/web/public/ui-final-v031/paper_trading_room/index.html`

1. **broker-strip 預設改為 paper**:
   - `kgi` button: 移除 `active` class
   - `paper` button: 加 `active` class，移除 `title="券商切換即將開放"` tooltip
   - `fubon` button: 保留 `disabled` 屬性不動

2. **submit button 預設**:
   - `#submit-btn`: 文字從 "送出紙上單" → "送出模擬訂單"
   - `#submit-kgi-sim-btn`: 加 `style="display:none"` (paper 預設不顯示)，文字從 "送出 KGI SIM" → "送出 KGI 模擬單"

#### `apps/web/lib/final-v031-paper-ticket.test.ts`

- 更新 `"wires the final-v031 trading room manual ticket to KGI SIM only"` 測試：
  - `"送出 KGI SIM"` → `"送出 KGI 模擬單"`（對齊 HTML 變更）
- 新增 `"broker selector defaults to paper and routes KGI through SIM channel"` 測試 (15 assertions):
  - paper button 有 `active` class
  - KGI button 無 `active` class
  - `#submit-kgi-sim-btn` 初始 hidden
  - localStorage key + helper functions 存在
  - `applyBrokerSubmitVisibility()` 被呼叫
  - 動態 label 用 `activeBrokerCopy.shortName`
  - fubon 永遠 `disabled`
  - UTA adapters API 被 fetch

---

## 修改檔案清單

| 檔案 | 變更類型 |
|------|---------|
| `apps/web/lib/final-v031-live.ts` | 修改（UTA fetch + broker helpers + hydrateBrokerStrip + applyBrokerSubmitVisibility + 動態 labels） |
| `apps/web/public/ui-final-v031/paper_trading_room/index.html` | 修改（broker-strip active 換 paper、submit button 初始 hidden/text） |
| `apps/web/lib/final-v031-paper-ticket.test.ts` | 修改（更新 1 test + 新增 1 test，共 +15 assertions） |

---

## Typecheck / Test 結果

- `pnpm --filter @iuf-trading-room/contracts build` — EXIT 0
- `pnpm --filter @iuf-trading-room/web typecheck` — EXIT 0 (0 errors)
- `pnpm --filter @iuf-trading-room/web test` — **369/369 PASS** (was 368, +1 new test)
  - `final-v031-paper-ticket.test.ts`: 47/47 PASS (was 46)

---

## SIM-safe 硬守確認

- `prod_write_blocked` 邏輯: 未動（KGI submit handler 仍走 `/api/ui-final-v031/backend?path=/api/v1/kgi/sim/order`，不是真金 `/trading/orders`）
- 「正式實單仍鎖定」: 保留在 gate 成功文字
- 富邦不可選: `disabled` 屬性保留，JS click handler 對 `fubon` 早 return
- 後端檔案: 0 行變更

---

## 驗證方式

**真瀏覽器驗證（需 owner session）：**

```bash
# 取得 owner cookie
curl -s -c /tmp/iuf_cookies.txt -b /tmp/iuf_cookies.txt \
  -X POST https://api.eycvector.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"qazabc159@gmail.com","password":"[REDACTED-OWNER-PW]"}'

# 開 /portfolio → iframe /api/ui-final-v031/paper-trading-room
# 驗證點：
# 1. broker-strip: paper 按鈕有高亮（active class），KGI 無高亮
# 2. 送出按鈕: 只顯示「送出模擬訂單」（KGI 按鈕 hidden）
# 3. 點 KGI 按鈕 → active 切換 → 按鈕變「送出 KGI 模擬單」
# 4. 重整頁面 → 選擇記憶（localStorage 持久）
# 5. 富邦按鈕 disabled 不可點
# 6. 真實下單路徑 /trading/orders 仍完全未開放
```

**注意**：驗證需在 Railway prod 部署後（deploy 觸發見 `#1067` 的 push→main 自動部署）或本地 dev server 驗。本次驗證為 typecheck + vitest 組合；本地 `next build` 有 pre-existing env 失敗（`@tailwindcss/postcss` + `lucide-react`），Railway CI 為 authoritative build check。

---

## 下一步建議

1. **Bruce smoke verify**: 部署後在 `/portfolio` iframe 裡點 KGI 按鈕送一筆 SIM 單，確認 gate 顯示「KGI 模擬單 已送出（正式實單仍鎖定）」。
2. **Phase 3 富邦接入（待楊董定案）**: 當富邦 gateway 就緒時，只需在後端 UTA adapters 把 `fubon` 的 `isActive=true`，並把 HTML `fubon` button 的 `disabled` 移除，前端選擇器邏輯已 ready。

---

*Jim / frontend-consume lane / 2026-06-24*
