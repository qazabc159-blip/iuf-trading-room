# C-2 連動三鍵 — 驗證紀錄 2026-07-09

範圍：`DAILY_DECISION_FLOW_DESIGN_v1.md` §4 連動規則中的三鍵（看公司／加觀察／帶入模擬單）+ 訊號時間戳誠實度。復盤頁「本週最大失誤」列**不在本切片**（backend 無對應欄位，見下方 escalation）。

## 自動化驗證
- `pnpm typecheck`：15/15 green
- `pnpm --filter @iuf-trading-room/web test`：58 files / 483 tests green（含新 `signal-freshness.test.ts` 12 個真斷言）
- `pnpm run build:web`：27+ routes 全綠，含 `/signals` `/themes/[short]` `/ai-recommendations` `/portfolio`

## 真瀏覽器驗證（local dev server + prod API + SEED_OWNER cookie）
方法：`next dev`（localhost:3000）+ `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com` + Playwright `auth.setup.ts` 產生的 owner storageState（cookie domain rewrite 到 localhost，沿用 PR #1181 recipe）。

1. **`ai-rec-manual-check.png`** — `/ai-recommendations`：6 張卡片全部掛上三鍵列（看公司／加觀察／帶入模擬單），文字與 hover/disabled 樣式正確。
2. **`signals-manual-check.png`** — `/signals`：目前正式訊號 0 筆（548 筆未連結不進清單），顯示誠實空狀態「無可判讀訊號」。CTA row / freshness label 程式碼路徑存在但目前無資料觸發，**非 bug**（詳 `page.tsx` `SIG-TAPE` 空狀態邏輯）。
3. **`theme-detail-manual-check.png` + `theme-member-crop.png`** — `/themes/5g`：141 檔成員全部掛 `MemberQuoteRow`（現價/漲跌%/加觀察鍵），紅漲綠跌配色與既有 `marketTone` 慣例一致；部分成員無報價顯示 `--`（誠實，非當 0）。
4. **Portfolio handoff round-trip**：直接打 `/portfolio?ticker=2330&prefill=true&side=buy` → iframe title 正確顯示「交易室 SIM 預覽 - 參數帶入 / 方向 買進 / 標的 2330」，確認 `SignalCtaRow`／`StockRecCard` 產生的查詢字串被既有 `portfolio-handoff.ts`（pre-existing infra）正確消費。

## 已知限制（非本切片程式碼問題，記錄供 Bruce/下個 session 參考）
- **本機測 POST `/api/v1/watchlist`（加觀察寫入）在此 local harness 下回 401**：瀏覽器對 `localhost:3000` → `https://api.eycvector.com` 屬跨站（cross-site，非同網域），Chromium 預設會擋第三方 cookie，導致 `credentials:"include"` 的跨源 POST 帶不到 session cookie。GET 類請求多半吃到 `SAME_ORIGIN_GET_PROXY_PATHS`（`lib/api.ts`）繞經本地 proxy 才躲過這個限制，POST 沒有對應 proxy path。
- 這不是新問題：`mobile-390.spec.ts` 對 `/`、`/alerts`、`/ai-recommendations`、`/companies/2330`（**4 條全部含我完全沒碰過的路由**）在同一本機環境下全部因相同 401 console noise 失敗，證實是 harness 限制而非本輪改動引入的迴歸。已有先例記錄在 `jim_memory.md` 2026-07-06 PR #1181 條目。
- Server 端 schema 已核對：`POST /api/v1/watchlist` 回 `{ok:true, symbol}`，`addWatchlistSymbol()` 解析方式吻合。正式部署（`app.eycvector.com` + `api.eycvector.com` 同一 parent domain，session cookie 非跨站）預期不會出現此問題，但**未在真實部署環境對這個新寫入路徑做過 e2e 驗證** — 建議 deploy 後由 Bruce 補打一次「加觀察」點擊 smoke。
