# 公司頁三項收尾 — 2026-07-17（Jim-6）

## ① 空態=整欄位移除（P1，楊董明令）

改動元件（全部原本恆渲染 loading/closed/waiting/blocked/empty 狀態卡，現在改成：
非 loading 且非 live/有內容 → `return null`，整個 `<section>` 不進 DOM）：

| 元件 | pairrow | 舊行為 | 新行為 |
|---|---|---|---|
| `BidAskPanel.tsx` | `#sec-quote` | closed/waiting/blocked 顯示「休市/待回傳/暫停」小徽章 | 三態一律 `return null` |
| `LiveTickStreamPanel.tsx` | `#sec-quote` | 同上 | 同上 |
| `InstitutionalPanel.tsx` | `#sec-chips` | blocked/empty 顯示「暫停/EMPTY」卡 | 同上 |
| `MarginShortPanel.tsx` | `#sec-chips` | blocked/empty 顯示「近 30 日暫無融資融券資料」卡（楊董裁決原文舉例） | 同上 |
| `CoverageKnowledgePanel.tsx` | `#company-knowledge` | not_found/error 顯示「coverage 待補」卡；loaded 但四類內容全空也會渲染空殼 | not_found/error/loaded-but-empty 一律 `return null` |
| `IndustryGraphPanel.tsx` | `#company-knowledge` | error/ready-無節點 顯示「圖譜資料整理中」卡 | 同上 |

保留：`loading`（transient，非「抓不到」，維持原本一行式讀取中提示）。

### CSS 補位（`CompanyPageStyleBlock.tsx`）
```css
@media (min-width: 1440px) {
  .co-v3-pairrow > .panel:only-child { grid-column: 1 / -1; }
}
.co-v3-pairrow:empty { display: none; }
```
純 CSS 解法（`:only-child` / `:empty`），不需要在手足 client component 間傳狀態。

### Playwright 證據（`packages/qa-playwright/tests/jim_company_empty_state_collapse_20260717.spec.ts`，本機對真 prod API 跑，desktop-chromium，3/3 PASS）
- mock 全空（full-profile 全 EMPTY + coverage 404 + shareholding 空）→ `#sec-chips`/`#company-knowledge` 0 panel 且 `toBeHidden()`；`#sec-hold` 不存在；body 文字不含「近 30 日暫無...」等舊佔位卡字樣；相鄰 `#sec-fin`/`#sec-detail` 正常顯示（無破版）。
- mock 只融資融券空、三大法人有資料 → `#sec-chips` 剩 1 panel，且該 panel 寬度 / pairrow 寬度 > 0.9（`:only-child` 補滿確認）。
- mock 兩者皆有資料 → `#sec-chips` 仍 2 panel（零退化）。

## ② `#1286` 孤兒 CSS 清理

刪除範圍（grep 全 repo 確認 JSX 零引用後才刪）：

| 檔案 | class | 說明 |
|---|---|---|
| `CompanyPageStyleBlock.tsx` | `._co-trading-view` / `._co-chart-pane` / `._co-depth-pane` | #1286 前的 K線+BidAsk 64/36 row split，已被 #1286 換成 `#sec-kline` 全寬 + pairrow |
| `CompanyPageStyleBlock.tsx` | `.company-knowledge-grid` | #1286 前的知識圖譜 2 欄 grid，已被 `.co-v3-pairrow` 取代 |
| `CompanyPageStyleBlock.tsx` | `.company-data-dock-title` | 舊「資料艙」標題間距規則 |
| `globals.css` | `.company-data-dock` / `.company-data-dock-title` / `.company-data-dock-tags` / `.company-data-side-rail` / `.company-data-status-rail`（含 media query） | #1286 前 page.tsx 的 `<div className="company-data-dock">` 三欄佈局，#1286 已改成 `.co-v3-pairrow`；`git show e20e1f19~1:.../page.tsx` 驗證確為 #1286 前活碼 |

**驗證**：改動後對全 7 個 class 名各跑一次 `grep -rn` 全 `apps/web`（`.tsx`/`.ts`/`.css`），全部零匹配（僅 globals.css 一處無害的歷史註解提及"company-data-dock vibe"，該行本身屬於仍在用的 `.full-profile-grid` regle，非孤兒程式碼，未動）。

**規模**：實際刪除 369 行（CompanyPageStyleBlock.tsx 123 行 + globals.css 258 行 - 12 行註解調整插入），比原估「約 130 行」多——覆核時發現 globals.css 也有一塊同源（#1286 拆掉 `<div className="company-data-dock">` 佈局）的孤兒規則，一併清除。

## ③ ChipsPanel 內部重複拆分（佇列 #17）

原本 `ChipsPanel.tsx` 同時打 `getCompanyChips`（三大法人 30 日 net + 融資融券餘額）與 `getCompanyShareholding`（外資持股/股權分散），畫面上與 `InstitutionalPanel`/`MarginShortPanel`（`#sec-chips` pairrow）完全重複顯示三大法人買賣超與融資券餘額。

**改法**：`ChipsPanel.tsx` 收斂為單一職責「外資持股與分佈」（對應 `DESIGN_NOTES.md` §三 #17 `#sec-hold`），移除 `getCompanyChips` 呼叫與 `NetRow`/`BalanceRow` 渲染，只保留 `ShareholdingBlock` 內容；state 從 4 態（loading/blocked/empty/live）×（chips+shareholding 兩份資料）簡化為單一 shareholding 資料源。空態同規則（blocked/empty → `return null`）。

新增 nav 索引項 `#sec-hold`（`CompanySideNavPanel`），對齊既有其他 section 的錨點慣例。

## 驗證

- typecheck: `pnpm typecheck` 15/15 綠
- unit test: `pnpm --filter @iuf-trading-room/web test -- --run` 84 files / 683 tests 全綠（含更新後的 `lib/final-v031-paper-ticket.test.ts` 兩則規則鎖：closed/waiting/blocked 三態 union 型別仍在、且不再出現「休市/待回傳」徽章 JSX）
- build: `pnpm --filter @iuf-trading-room/web build` 綠，`/companies/[symbol]` 頁面照常產出
- Playwright（本機 `next dev` 對真 prod API，desktop-chromium）：
  - 新規格 `jim_company_empty_state_collapse_20260717.spec.ts` 3/3 PASS
  - 既有 `company.spec.ts`（permanent CI smoke，>=9 panel 斷言）PASS，未受影響
  - 既有 `jim_company_page_v3_20260716.spec.ts`（非 permanent gate，manual verification）6 條中已知 2 條斷言假設「`#sec-quote` 恆為 2 panel」與本次修復直接衝突（該斷言正是舊行為的迴歸鎖，現在離峰盤合理收合為 0 panel）——已在同檔案更新為「0 或 2」與改測不受時段影響的 `#sec-chips`；其餘 2 條失敗（FinancialsPanel 分頁點擊 timeout、AI 報告文字對不上）與本次改動的檔案（BidAskPanel/InstitutionalPanel/MarginShortPanel/CoverageKnowledgePanel/IndustryGraphPanel/ChipsPanel/page.tsx/CSS）無關，未觸碰，視為既有環境/權限問題不在本輪範圍內修復

## 意外（非計畫內）

1. **本機 Playwright mock 對此 repo 的 PWA Service Worker 無效**：`public/sw.js` 對所有 `/api/**` 請求一律 `event.respondWith(fetch(request,{cache:"no-store"}))`（SW 自己重發 fetch），導致 `page.route()` 攔截不到這些請求（`page.on("request")` 看得到請求但 `page.route()` handler 永遠不觸發）；改用 `context.route()`（BrowserContext 層級）才能正確攔截 SW 代發的請求。這是本次除錯耗時最久的一步，值得寫入 memory。
2. **`/api/v1/companies/:id/quote/realtime` 目前對本機開發環境呼叫真 prod backend 會掛住 90 秒以上不返回**（curl 直測 90s timeout 仍未收到回應）；此端點由 `page.tsx` 的 SSR `Promise.allSettled` 呼叫，拖慢了整個公司頁 SSR。這與本次修復無關（未改動 quote/realtime 相關程式碼），但拖慢了本地驗證速度——本機用一個臨時 smart-proxy（僅本機驗證用，未進 repo）短路這支端點為秒回 BLOCKED 假資料，其餘端點原樣轉發真 prod，藉此讓後續驗證可行。**回報 Elva/Jason 參考**：此端點在盤中/盤後皆可能出現長時間無回應，若 SSR 沒有逐一 timeout 保護，理論上會拖慢整個公司頁首屏。
3. Mock 用的 `FullProfileEnvelope` 一開始只填了 `tradingFlow.{institutional,marginShort}`，忽略 `FullProfilePanels.tsx`（[06]-[11] 延伸區）也讀同一份 full-profile response 的 `fundamentals`/`marketIntel` 欄位，導致該元件對 `undefined.financialStatement` 拋錯、整頁被 `error.tsx` 邊界攔下——已修正為完整涵蓋全部 section 的 stub。
