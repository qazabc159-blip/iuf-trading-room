# PR-B 盤口密度 — 驗收證據 (2026-07-10)

Branch: `feat/depth-density-jim-20260710`（疊在 PR-A `feat/order-status-strip-jim-20260710` 之上）

## 真狀況（真 owner session + prod 資料，實測，非猜測）

KGI gateway quote auth 自 6/2 起壞到現在（`GET /api/v1/kgi/quote/bidask` 對 prod 回 503
`GATEWAY_UNREACHABLE`），此刻無法用真實五檔資料驗證。改用 Playwright 直接對 `#depth` 注入
與 app 真實 `renderDepthPanel()` 完全相同結構的 5+5 檔 fixture，純驗證 CSS/layout 密度改動
（不涉及資料抓取路徑，抓取路徑未變動）。

## 修前真相（stash 回退實測，非事後合理化）

用 `git stash` 暫時退回改動前的 trading.css/final-v031-live.ts，對同一支 dev server 打同
一組 fixture 量測：
- `#depth` 的 `getBoundingClientRect().height` = **234px**，但外層 `.tape` grid row 只分到
  **70-86px**（受 `.cpane` 固定 `grid-template-rows` 所限，本次未動該結構）。
- `overflow-y` 電腦樣式是 **`visible`**（完全沒有邊界）——內容無聲溢出自己的框，只是被更上層
  `.cpane{overflow:hidden}` 硬裁。
- 螢幕截圖（`PR-B_depth_before_20260710.png`）清楚看到：只有 953.00/953.50/954.00 三檔露出，
  第三檔「954.00」被硬生生從中間切一半，沒有捲軸、沒有任何「還有更多檔位」的提示——其餘 8 檔
  （5 買 + 分隔列的一半）**完全不可見也不可觸及**。

## 修後（本 PR）

- `#depth` 改用 `overflow-y:auto` 真正包住自己的框（`containerHeight` 桌面實測 41-53px，
  受同一個 `.cpane` 列高限制，此限制本次刻意不動）。
- 單列高度從 ~15-18px（依 viewport-height media query 而異）壓到 **13px**（10.5px 字 /
  1.05 行高，仍維持 `font-variant-numeric:tabular-nums` 等寬數字）。
- 新增「內外盤比」買賣力道視覺化列（沿用既有 `--ok`/`--bad` 色 token，不發明新色）。
- 新增逐檔 tick 閃爍：只在該檔位價格真的變動時觸發一次（節制），`@media
  (prefers-reduced-motion: reduce)` 關閉動畫。
- **誠實結論**：受限於既有 `.cpane` 固定列高（本次不可動的結構），同時可見檔位數只從約
  2.5 檔（且中間硬切）微幅提升到約 2-3 檔（含內外盤比列）——不是戲劇性的「一次看到全部
  11 檔」。真正修掉的是背後的真 bug：**原本 8 檔完全沒有任何方式看到，現在全部 12 列（11
  真檔位 + 1 內外盤比列）都可透過捲動到達**，且不再有「內容無邊界溢出、硬切一半」的破版
  現象。截圖 `PR-B_depth_after_crop_top_20260710.png`（捲動最上方：內外盤比＋最佳賣價）與
  `PR-B_depth_after_crop_scrolled_20260710.png`（捲到底：買方檔位）示範捲動確實有效。

## 手機驗證（真的抓到一個回歸，已修）

初版只用 `flex:1 1 auto;min-height:0` 讓 `.stk` 吃父層剩餘高度，桌面沒問題，但手機
`.troom` 在 `max-width:767px` 會整個換成 `flex column`，`.cpane` 內部固定列高的鏈斷掉，
`.tape>div` 實測父層只分到 22px、`flex-grow` 沒東西可分、`min-height:0` 又准許縮到 0
→ `#depth` 整個塌成 0 高度、Playwright `toBeVisible()` 判 `hidden`——**真的手機倒退**，
不是原本就這樣（同一支 Playwright 對改動前的程式碼跑同一個斷言是 PASS 的）。已在
`max-width:767px` 區塊內加 `.tape .stk{flex:0 0 auto;min-height:70px;max-height:200px}`
修正，桌面行為不受影響（該規則只在 767px 以下生效）。

## 綠燈（含真 Playwright，desktop + mobile 皆過）

```
IUF_QA_WEB_BASE_URL=http://localhost:3000 IUF_QA_API_BASE_URL=https://api.eycvector.com \
  npx playwright test jim_depth_density_20260710.spec.ts jim_uta_orders_report_20260710.spec.ts \
  --project=desktop-chromium --project=mobile-iphone-13
# 7 passed
```
量化斷言（`jim_depth_density_20260710.spec.ts`，附 JSON metrics attachment）：
- 12 列（11 真檔位 + 1 內外盤比）全部存在於 DOM
- 單列高度 < 15px（實測 13px，桌面）
- 至少 2 列在無捲動狀態下可見
- 未全部可見時必須可捲動到達（`overflowY === "auto"`，非 `visible`）
- 內外盤比色沿用既有 `--ok`/`--bad` token，非新色

其餘：
- `pnpm typecheck` 15/15
- `pnpm --filter @iuf-trading-room/web test` 518/518（515 既有 + 3 新增 source-substring
  覆蓋 renderDepthPanel 收斂/內外盤比+閃爍/密度+捲動邊界）
- `pnpm run build:web` green
- `packages/qa-playwright/tests/portfolio.spec.ts` 交叉驗證：`/portfolio` 第一條測試（含
  嚴格 zero-overflow 斷言，`bodyOverflow`/`roomOverflow`/`rightPaneOverflow` 等）PASS，
  無版面回歸。第二條測試（K 線 MA20 toggle 狀態）FAIL，但用 `git stash` 退回 PR-B 改動前
  重跑同一測試**同樣 FAIL**，證實與本次改動無關（既有、與 K 線 iframe 相關的既存缺陷，不
  在本 PR 範圍）。
