# PR-4 統一下單流：帳號帶（D6）— 驗證紀錄（2026-07-09）

## 範圍
- 券商列改吃 `GET /api/v1/uta/accounts`（`clientPaperPayload()` 內，取代舊 `/uta/adapters` 目錄）
- 每個可選按鈕（paper／kgi）顯示 gatewayStatus 四態徽章（unpaired／pending／paired_unreachable／reachable），
  文案/配色與 `/settings/broker` 信任卡（#1163，`broker-connections.tsx`）一致
- fubon 維持 disabled「即將開放」，不進帳號帶
- active 帳號記憶沿用既有 `iuf-active-broker` localStorage（paper/kgi 1:1 對應帳號，broker key 記憶即帳號記憶）
- PR-3 的 `loadBrokerAccounts()` 改為優先重用帳號帶已抓好的 `live.accounts`，避免送單時重複打一次 API

## 新增可測試邏輯
`gatewayStatusBadge()`（`apps/web/lib/final-v031-live.ts`，template 外的真 TS function）— 四態 fixture 單元測試見
`apps/web/lib/final-v031-gateway-status-badge.test.ts`（6 tests，含未知碼 fallback 不崩潰）。行內 script 版本
（`gatewayBadge()`）鏡射同一份 mapping，理由與 PR-3 的 reason-code vocab 相同：整段以字串注入、無 bundler
import。

## 真瀏覽器驗證（local dev + prod API + 真 owner cookie）
`packages/qa-playwright/tests/jim_pr4_account_strip_20260709.spec.ts`，3/3 PASS：
1. **badge 渲染**：paper／kgi 按鈕各自出現 `.bstat` 徽章，皆屬四個已知中文標籤之一（本次 session 因無真實
   gateway 配對代理連線，兩者皆為「未配對」— 真實狀態，非假資料）；fubon 無徽章、維持 disabled。
2. **帳號路由**：切到 KGI 送單→payload accountId 非空；切回 paper 送單→payload accountId 非空且與 KGI 那筆
   不同 —— 證實 `accountIdForBroker` 依目前選中的券商正確路由到不同帳號列。
3. **fubon 永遠 disabled** + 文案「即將開放」。

截圖見 `pr4_screenshots/`。

## 手機 390px 檢查（動員令附加）
`packages/qa-playwright/tests/jim_mobile_order_flow_20260709.spec.ts`（`mobile-iphone-13` project），2/2 PASS
（含 1 個小修併入本 PR，詳見下方缺口清單）：
- 頁面本身無橫向 overflow
- 送出鈕觸控目標修至 ≥44px（`route.ts` 的 `.tactions .submit` 桌面緊湊模式固定 `min-height:40px`，僅在
  `@media (max-width:767px)` 內新增 `44px` 覆蓋，桌面值不動）
- 錯誤場景（盤後風控擋單）文案為中文「未通過：交易時段」，非原文

### 🟡 手機缺口清單（大缺口，不硬做，回報）
1. **P0：/portfolio 嵌入式交易室在 390px 下，app 殼層側邊欄 `<aside class="app-sidebar">` 覆蓋整個
   viewport 並攔截點擊**——Playwright 對 `#submit-btn` 的一般 `.click()` 直接 timeout（重試 40+ 次皆回報
   `<aside class="app-sidebar app-tactical-sidebar tac-sidebar"> intercepts pointer events`），必須用
   `{force:true}` 才能繼續驗證流程。從最初載入就存在（非我方送單改動觸發），畫面呈現整片深色貼圖蓋在內容上
   （見 `mobile_390/mobile390_order_flow_panel_open_mobile-iphone-13.png`）。**根因研判**：`FinalOnlyFrame.tsx`
   有規則在桌面寬度把 `.app-sidebar` 挪出全螢幕交易室之外（`body:has(...[data-final-screen="paper-trading-room"])
   .app-sidebar {...}`），但這條規則疑似未涵蓋行動裝置寬度（or 被 Sidebar.tsx 自己的手機版 drawer 邏輯覆蓋回
   來）。**未修**：根因在 `apps/web/components/FinalOnlyFrame.tsx`／`Sidebar.tsx`（app 殼層），不在本 PR
   `final-v031-live.ts`／`route.ts` 範圍內，且需要完整手機導覽抽屜狀態機知識才能安全修，貿然動有連坐風險。
   **同時發現**：既有 `mobile-390.spec.ts` 的 M1-M3 三輪從未真的 frameLocator 進 `/portfolio`／`/market-intel`
   這兩個 `FinalOnlyFrame` 全螢幕 iframe 頁面內部（M3 交接記錄明講：「`/market-intel` 是 iframe 包裝頁，
   parent-DOM audit 看不到 iframe 內部，沒東西可修」）——這代表**這是全站行動裝置 gap 盤點裡從未被真正驗證過的
   一塊**，建議另立 M4 或直接指派給 Sidebar/shell owner。
2. **P2：qty 加減鈕（`.stepbtn`）31×32px、券商列按鈕（`.bbtn`）高度 29px**，皆低於 44px 基準。未修：
   `.brokerstrip` 高度 30px 是寫死在多處版面計算裡的常數（`.troom { height: calc(100dvh - 62px) }`、
   `.brokerstrip { top: 32px }` 等），單獨改按鈕高度不動這些常數會裁切/擠壓版面；`.stepbtn` 同理卡在
   `.tform .field .step { grid-template-columns: 31px minmax(0,1fr) 31px }` 固定寬度。兩者都需要一次完整的
   行動裝置版面重排（非本 PR 的「小修」範圍），與上述 P0 一起列為後續 M4 候選項目。

## 驗證
- typecheck 15/15 綠（含 `gatewayStatusBadge` 新函式）
- `pnpm --filter @iuf-trading-room/web test`：479/479 綠（+7 新測試：6 badge fixture + 1 D6 broker-strip 結構斷言）
- `pnpm run build:web`：全綠
