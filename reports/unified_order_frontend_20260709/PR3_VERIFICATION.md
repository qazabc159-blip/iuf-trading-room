# PR-3 統一下單流：iframe 雙 handler 合一 — 驗證紀錄（2026-07-09）

## 範圍
`apps/web/lib/final-v031-live.ts` 的 `submit`（紙上單）與 `kgiSubmit`（KGI SIM 單）兩條 click handler
收斂為單一送單路徑，統一打 `POST /api/v1/trading/orders`（經 `/api/ui-final-v031/backend` proxy，已在 #1165
放行）。Preview 呼叫維持 `/api/v1/paper/preview` 不動（設計 §4 PR-3 範圍明定）。

## 意外發現＋一併修復（非本輪引入，但擋住本輪驗證）
`hydratePaper()` 在每次 `refreshClientLive()` 輪詢（含首次 fastPaperShell 佔位 render）都會重新對
`#submit-btn`／`#submit-kgi-sim-btn` 呼叫 `addEventListener`，且無去重旗標（對照同檔
`hydrateBrokerStrip()` 已有的 `dataset.brokerClickWired` 寫法）。第一次掛上的 listener（來自
fastPaperShell 佔位渲染，`capitalReady` 恆為 false）先跑，呼叫 `stopImmediatePropagation()`
後才做 `if (!capitalReady) return`，導致同一節點後續掛上的所有 listener（含拿到真資料、
`capitalReady=true` 的那個）永遠拿不到事件——**送出鈕點擊在多次 hydration 後實質上失效**。
用 `packages/qa-playwright/tests` 一支臨時 debug spec（monkeypatch `addEventListener` 計數＋CDP 追蹤，
已刪除不留在 repo）實測 5 秒內堆疊 3 個 listener，且對**目前已部署 prod（尚未含本 PR）跑同一支
debug spec 得到相同結果**——證實是既有 bug，非本次改動造成，但因為擋住「送出鈕能不能真的打到
新端點」的驗證，一併用同檔案已有的 `dataset.xxxWired` 模式修掉：listener 只掛一次，
`capitalReady`／`selected`／(KGI 的) `activeBrokerCopy` 改在 click 當下從共用的 `live` 物件／
`activeBrokerKey()` 現讀，不再吃 hydration 當下凍結的舊值。

## 真瀏覽器驗證方法
- Local `next dev`（port 3000）+ `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`（本分支程式碼
  serve，prod 資料/prod 帳號，因為本分支尚未部署，直接測 app.eycvector.com 會測到舊 code）
- `railway variables --service api --kv` 取 `SEED_OWNER_*` → `packages/qa-playwright/tests/auth.setup.ts`
  登入拿 cookie，改寫 cookie domain 到 localhost（既有 recipe）
- 驗證時間為 2026-07-09 22:5x TST（**盤後**）——`packages/qa-playwright/tests/jim_pr3_unified_order_20260709.spec.ts`
  的斷言因此針對「風控在非交易時段正確擋單」的真實情境設計，而非成功送出（盤中才可能發生成功送出）

## 結果（4/4 PASS，screenshots 見 pr3_screenshots/）
1. **paper ticket** → 點擊後真的打到 `POST /api/v1/trading/orders`（經 proxy，網路 trace 確認）；
   零 legacy 端點呼叫；因非交易時段被風控擋下，gate 顯示「未通過：交易時段」（中文詞彙表映射，
   非後端原文 `Blocked by trading_hours.`）
2. **KGI SIM ticket** → 切換券商列到凱基後同樣打統一端點；零 legacy `/kgi/sim/order` 呼叫；
   送單節奏不變（無新增確認 modal，一鍵直送）；錯誤文案同樣是「未通過：交易時段」
3. **invalid ticket**（qty=0）→ 維持既有純前端驗證行為，按鈕本地即被 disable，零網路呼叫
4. `pr3_before_submit_paper` vs `pr3_after_submit_paper`：可見送出按鈕文案從「送出紙上單...」變為
   「紙上單未通過」，gate 框從空白變為「未通過：交易時段」

## 額外對照（prod_check/，證明 listener-stacking 是既有 bug）
同一支 debug spec（未收進本 PR，執行紀錄見此）直接打**目前已部署的 prod**（尚未含本 PR 任何改動），
一樣量到 3 個堆疊 listener、一樣點擊後沒有任何網路呼叫發生——證實此 bug 在本 PR 之前就存在。
