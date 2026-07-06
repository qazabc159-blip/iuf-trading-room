# Mobile M1 — 390px 讀路徑基線（首頁 / AI 推薦 / 警示）

派工：行動體驗 M1 第一波。三個最高頻讀路徑在 390px 寬修到手機可用，並建立防回歸基線。
**行為零變更，純呈現層（CSS-only + 一個 className 掛點 + 一個 scroll wrapper div）。**

## 證據檔案

| 檔案 | 說明 |
|---|---|
| `before_*_390.png` / `after_*_390.png` | 三頁 390×844 全頁截圖（本機 dev server，iPhone 13 viewport） |
| `before_a11y_overflow_audit.json` / `after_a11y_overflow_audit.json` | 逐頁自動審計：頁面級水平溢出量測（scrollWidth vs clientWidth）、寬度超標元素清單、<14px 字級清單、<44px 觸控目標清單 |

量測環境註記：本機 dev server 無 CI owner 憑證，以本機 session cookie 通過 middleware 閘（僅檢查 cookie 存在）；後端 API 照常逾時/拒絕，頁面呈現的是真實 BLOCKED/EMPTY 狀態 — DOM 結構與 LIVE 態同一套 class，量測有效。CI 端 `mobile-390.spec` 用真憑證跑。

## Before 現況（390px 實測）

- **三頁的頁面本體都沒有水平溢出**（doc scrollWidth = clientWidth = 390）— 既有的 760px/640px 斷點已把主 grid 收成單欄。真正的問題在「可用性」層：
- 首頁：`.tac-fresh-list a`（資料新鮮度面板的 8 條可點列）實測高度 **13px** — 遠低於 44px 觸控標準；熱力圖模式 tab 42px 差一點。
- AI 推薦：v3 卡的 8 欄 sub-score 表在 390px 被壓縮到不可讀；回饋按鈕（有幫助/不準確/略過）32px、查看詳情 34px；理由/風險/交易計畫大量 12px 內文。
- 警示：hero KPI 在 640px 斷點收成 2 欄後餘一格空洞、52px 大數字擠壓；規則名 12px / 描述 11px；dispatch 按鈕約 33px。

## 修了什麼（全部 `@media (max-width: 480px)`，不影響桌機）

1. `apps/web/app/globals.css` — `.tac-fresh-list a` 補 min-height 44px + padding；label 字級提到 13px。
2. `apps/web/app/main-market-wire.css` — 熱力圖模式 tab min-height 44px。
3. `apps/web/app/ai-recommendations/page.tsx`（inline style 區塊）— tabs/prefill/詳情連結/回饋按鈕 min-height 44px；理由、風險、交易計畫內文提到 14px。
4. `apps/web/app/ai-recommendations/StockRecCard.tsx` — sub-score 表包進 `._src-score-scroll`（overflow-x:auto 容器內橫向滾動，頁面本體不滾）＋ min-width 480px 維持欄寬可讀；卡片內文 13px 下限。
5. `apps/web/app/alerts/page.tsx` — hero KPI <480px 收單欄全寬；規則名 14px / 描述 13px / 摘要 14px；dispatch 按鈕（`AlertDispatchButton.tsx` 掛 `_alr-dispatch-btn` class）min-height 44px。

## After 實測

- 三頁 doc scrollWidth 維持 390（無頁面級水平溢出）。
- 目標頁內的觸控目標全部 ≥44px。剩餘 <44px 項目全部屬**共用 header dock**（`header-dock-button` 36px、Cmd-K 搜尋鈕 32px）— 共用元件不在本次檔案範圍（一 writer 原則），列 M2 待辦。

## 防回歸基線

`packages/qa-playwright/tests/mobile-390.spec.ts` — 跑在既有 `mobile-iphone-13` project（390×844）：
- 每頁斷言 ①無頁面級水平溢出（scrollWidth ≤ clientWidth+1）②關鍵元素可見 ③無 blocking console error。
- 桌機 project 自動 skip，不影響既有 P0 smoke。
- M2-M4 加頁面就往 `ROUTES` 陣列 append。
