# PR #1256 Desk Review — Pete 2026-07-14

## 1. PR Intent
- 首頁美術打槍 6 輪後改走「原封搬原稿」路線：把 artifact 原稿（桌機/手機兩套版面）的 `<style>` 與 layout **byte-exact** 搬成獨立靜態頁 `/home-exact`，只用一支 inline hydration script 注入真資料（token 換真值、缺料誠實 EMPTY），CSS/layout/class 完全不動 — fidelity 由「用原稿本尊 bytes」構造保證，不靠自評吻合。
- 對應 sprint task：W6 首頁 v5 系列的隔離預覽驗收步驟（7/13 深夜 handoff 記錄「首頁要一模一樣」）。
- Base branch：`main`（merge-base = `origin/main` HEAD `5fb56778`，非落後 stale base）。
- 明確聲明本 PR **完全不動現有 `/`**，只新增隔離預覽路由，過關後才會另開 PR 切正式首頁。

## 2. Diff Summary
- 改了 10 個檔（`gh pr view` 與 `git diff origin/main...HEAD --stat` 交叉核對一致）
- 主要改動：
  - 新增 `apps/web/public/home-exact/index.html`（1142 行，逐字原稿 CSS + 兩版面 + inline hydration script）
  - 新增 `apps/web/app/home-exact/page.tsx`（全屏 iframe wrapper，`body:has()` scope key 隱藏側欄/HeaderDock）
  - 新增 `apps/web/app/api/home-exact/recommendations/route.ts`（重用既有 `deriveHomeAiRecommendationCards`）
  - `apps/web/app/api/ui-final-v031/backend/route.ts`：GET allowlist **+7 additive regex**
  - 新增 Playwright spec、data-wiring 報告、recovery checkpoint、截圖、原稿存檔
- LOC：+2390 / -0（**零刪除** — 與 PR 聲稱「完全不動現有 `/`」的 additive-only 主張互相印證，非僅口頭宣稱）

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] PASS — grep 全 diff `kill_switch|KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|order/create` 零命中
- [x] PASS — 無新下單路徑；`/home-exact` 是唯讀展示頁
- [x] N/A — 本 PR 未新增任何下單呼叫
- [x] PASS — 無 feature flag 新增

### B. Auth / Secret Hygiene
- [x] PASS — `apps/web/app/home-exact/page.tsx` 不在 middleware `PUBLIC_PATHS`，走 `iuf_session` cookie 預設 deny（未登入導向 `/login`）；靜態檔 `public/home-exact/index.html` 因 `.html` 副檔名不在 matcher 排除清單內，同樣被 middleware 攔截要求登入 — 與既有 `ui-final-v031/paper_trading_room` 等靜態 iframe 頁同一 pattern，非新開的未認證缺口
- [x] PASS — grep 全 diff `apiKey|api_key|secret|password|Bearer |authorization:` 零命中
- [x] N/A — 無新 env var
- [x] PASS — 新 API route `/api/home-exact/recommendations` 透過 `lib/api.ts` 的 `requestRaw()` 在 server context 轉發 request 的 session cookie 給後端（`next/headers` 讀 incoming cookie），非匿名直打；此路由跟其他 `/api/*` 一樣落在 middleware 的既有全域 `pathname.startsWith("/api/")` 放行規則內（pre-existing 行為，非本 PR 新增的例外）

### C. State / Schema Integrity
- [x] N/A — 無 DB schema / migration 變更
- [x] N/A — 無 enum / status string 變更
- [x] N/A — 無 state machine 變更
- [x] N/A — 無新 runtime module-level state

### D. PR Hygiene
- [x] PASS — commit messages 遵循 conventional commits（feat/chore/docs/fix）
- [x] PASS — DRAFT 起手、base=main 正確、非疊層鏈但單獨完整
- [x] PASS — PR description 完整列出 evidence path、驗證結果（typecheck/test/build/Playwright）、已知 gap（TAIEX 44,6xx / 漲跌家數 EMPTY / S1 cont_liq_v36）並註明非本 PR 引入
- [x] PASS — CI 四關全綠：`validate` / `W6 No-Real-Order Audit` / `Secret Regression Check (A2)` / `Playwright P0 Smoke` 皆 SUCCESS（`gh pr view --json statusCheckRollup` 實查，非憑印象）

### E. IUF-Specific 不可越線
- [x] PASS — 未見越 lane 痕跡
- [x] PASS — 無 governance bypass；仍是 DRAFT，未 merge
- [x] PASS — 全 diff 零 KGI `/order/create` 呼叫
- [x] PASS — reports/ 新增檔案掃過，無 person_id / token 明碼

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
無。

### 🟡 Suggestions (should fix)
1. **新 Playwright spec 掛 `@smoke` 標籤，會被拉進常駐 P0 Smoke gate**
   - 位置：`packages/qa-playwright/tests/jim_home_exact_preview_20260714.spec.ts:6`（`test.describe("@smoke /home-exact preview", ...)`）
   - 原因：本檔自己的註解寫「這支測試檔是本輪任務的驗收 harness，非長駐 CI spec；驗收後可視需要保留或移除」，但 `@smoke` tag 會被 `packages/qa-playwright/package.json` 的 `qa:playwright:smoke` script（`playwright test --grep @smoke --project=desktop-chromium`）直接吃進，等於**現在就已經**是每個 PR 的 CI — Validate / Playwright P0 Smoke 常駐關卡的一部分，不是作者自己認知的「可選、驗收後即棄用」。比對現有 30 支 spec，只有 7 支核心穩定檔（`fauto` / `invite-team` / `market-intel` / `portfolio` / `site-health` / `track-record` + 這支新檔）掛 `@smoke`；其餘所有帶日期戳的 `jim_*_2026xxxx.spec.ts` 一次性驗收檔全部**沒有**掛 `@smoke`，這支是唯一例外，與既有慣例不符。
   - 影響：此測試斷言依賴即時行情（`heat-grid` 至少 2 tile、`idx-int` 非空等），若未來盤後/假日/上游資料源異常時間點跑 CI，可能讓**所有未來、跟 /home-exact 完全無關的 PR** 因為這支一次性驗收 spec 而在 P0 gate 卡關，違反「CI 紅有明確根因」的治理精神。
   - 建議：merge 前把這支 spec 的 `@smoke` 拿掉（保留檔案本身當驗收記錄即可），或依作者自己註解所述，驗收後直接刪除此 spec。Owner: Jim。

2. **「加觀察」按鈕是死連結**
   - 位置：`apps/web/public/home-exact/index.html:954, 962`（`<a>加觀察</a>` 無 `href`/`onclick`）
   - 原因：推測是原稿 artifact 本來就是靜態展示按鈕，本 PR 刻意「CSS/layout/class 零改動」所以沒補行為，這在隔離預覽階段可接受，但若直接原封切入正式 `/` 會變成看起來能點但點了無反應的假按鈕，違反「不誠實 UI」精神的鄰近風險。
   - 建議：下一輪切正式 `/` 前一併決定「加觀察」的真實行為（呼叫既有 watchlist API 或先隱藏），不必卡這輪隔離預覽。Owner: Jim（下一 PR）。

### 💭 Nits (nice to have)
1. `readPath()` 對 query string `path` 參數的驗證邏輯（`startsWith("/api/v1/")` + 禁 `://`/`\`/換行）是既有程式碼、本 PR 未動，僅新增 7 條 allowlist regex；沒有問題，純紀錄核對過的範圍避免下一位 reviewer 重查。
2. `reports/homepage_v51_20260713/` 底下混了 `.md` 報告與截圖 `.png`，是既有慣例（其他 sprint 也這樣放），非本 PR 產生的新問題，僅備註。

### ✅ Praise
- **Fidelity 保證方式做得對**：不是「仿製後自評像不像」，而是用原稿 bytes 本身當唯一 CSS/layout 來源，只加 `data-slot` hook，這個做法直接消掉了前 6 輪打槍的根因（仿製漂移），是本輪最重要的架構決策，執行也確實做到零 CSS/layout/class 改動（審過 script 段落，所有寫入都走 `data-slot` textContent/attribute，沒有動到樣式類別）。
- **Proxy allowlist 7 條新規則全部收斂在既有 additive-only pattern**：沒有新增萬用萬用字元、沒有碰 POST_ALLOWLIST、沒有動 `readPath()` 的路徑驗證邏輯，SSRF/過寬疑慮逐條核過皆為固定前綴 + `/api/v1/` 硬性限制，風險面完全可控。
- **誠實 UI 紀律做得紮實**：inline script 每個資料區塊都有明確 `--`/EMPTY fallback（非假數字），還額外做了 `maskUnsafeAdvice()` 主動遮蔽「買進/賣出/目標價/必賺/保證/勝率」等字樣，是超出本次 checklist 要求、主動補的防線。
- **驗證誠實**：PR description 明確把「TAIEX 44,6xx 顯示異常」「漲跌家數 EMPTY」「S1 接 cont_liq_v36」三項已知問題揭露為「非本 PR 引入、現行 `/` 亦同」，附了查證方式（打過 prod 端點本身），不是含糊帶過。

## 5. Verdict
- [x] **APPROVED** — 可 ready，無 🔴 blocker。2 個 🟡 建議修但不阻塞（尤其 #1 建議在 merge 前處理，避免留一個永久性 CI 陷阱），非結構性問題。

## 6. Suggested Owner for Fixes
- 🟡 #1（`@smoke` tag 建議拿掉/移除 spec）→ Jim
- 🟡 #2（「加觀察」死連結）→ Jim（可延到下一輪切正式 `/` 時一併處理）

## 7. Re-review Required
NO（🟡 項可由 Jim 自行處理或 Elva 直接決定是否阻塞；不影響本輪 verdict）

---
Reviewer: Pete
Date: 2026-07-14
Sprint: W6 Day 14（首頁隔離預覽驗收輪）
