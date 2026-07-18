# PR #1306 Desk Review — Pete 2026-07-19

## 1. PR Intent
- 消除 `/companies/[symbol]` 每載必發的 React 錯誤 #418（hydration text mismatch）。
- 對應 sprint task：楊董「全站零錯誤」走查佇列（company page 早先由 Bruce 標記為已知舊坑，見
  `bruce_memory.md:234` / `:4092-4110`「🟡 React#418 為已知舊坑」）。
- Base branch：`main`（確認 `gh pr view --json baseRefName` = `main`，非疊層鏈的中游分支）。

## 2. Diff Summary
- 改 2 個檔：+77 / −1
  - `apps/web/app/companies/[symbol]/CompanyPageStyleBlock.tsx`：+9/−1，僅改一段 CSS 註解文字
  - `packages/qa-playwright/tests/jim3_company_hydration_20260719.spec.ts`：新檔 +68，回歸鎖 spec
- 主要改動：把 CSS 字串內一段註解裡的字面 `<style>` 四字元子字串改寫成純文字「style element」，
  並加防再犯提示；新增 4 組合（2330/3661 × desktop/mobile）Playwright spec 斷言零 `pageerror`。

## 3. IUF Blocker Checklist

| 項目 | 結果 |
|---|---|
| A. Kill-switch / Real-order safety | N/A — 未觸碰任何下單/gateway 路徑 |
| B. Auth / Secret hygiene | N/A — 未新增 endpoint、無 secret/token 出現 |
| C. State / Schema integrity | N/A — 無 migration、無 enum/state machine 變動 |
| D. PR hygiene | PASS — 標題 `fix(web): eliminate React #418...`、conventional commit、base=main 正確、PR body 附 test plan+已知殘缺揭露 |
| E. IUF 不可越線 | PASS — 無 lane 越界、無 governance bypass、無 KGI `/order/create`、無 redaction 違規 |

## 4. Findings — Priority Ranked

### 🔴 Blockers
（無）

### 🟡 Suggestions
1. **新回歸鎖 spec 未被任何 PR-gating CI 執行**
   - 位置：`packages/qa-playwright/tests/jim3_company_hydration_20260719.spec.ts`；CI 對照
     `.github/workflows/ci.yml:268`（`Market Intel smoke` 步驟跑 `pnpm qa:playwright:smoke` =
     `playwright test --grep @smoke`）；新 spec 4 個 test title 均不含 `@smoke` tag（已 grep 確認）。
   - 原因：PR 自稱「regression lock」，但實際上這支 spec 不在唯一會跑在每個 PR 上的 Playwright
     gate（`@smoke` 子集）裡，也不在 `pnpm --filter web test`（vitest，708/708 綠是這個，非
     Playwright）裡。換句話說，若日後有人在同一個 CSS 字串裡再次手滑打出字面 `<style>`，這支
     spec **不會自動擋下來**，除非有人記得手動全量跑 Playwright。
   - 已查：這不是本 PR 獨有的破口——現有 50 支 spec 只有 10 支掛 `@smoke`，連最近的
     `jim_company_empty_state_collapse_20260717.spec.ts`、`jim_home_interactions_20260714.spec.ts`
     也都沒掛，屬全 repo 既有慣例（多數 spec 定位是文件化/人工複驗用，非自動 CI gate）。因此不
     視為本 PR 專屬缺陷，而是系統性欠帳，降為 🟡 非 🔴。
   - 建議：至少替其中一組（如 desktop×2330）補 `@smoke` tag 納入 PR gate，或排進
     daily-prod-smoke，讓「regression lock」名副其實。
2. **根因敘事的深層機制未經獨立驗證，且同款字面樣板還有 14 個姊妹檔案未做系統性掃描**
   - 位置：PR body / commit message「React's SSR HTML serializer... `<\73 tyle>`...」段落。
   - 原因：這段機制描述（CSS hex escape、RSC payload 不鏡像跳脫）屬未經我獨立核對 React/RSC
     原始碼的推論性敘事；但作者有做過一次有力的因果驗證——**自我遞歸測試**：第一次修法把說明文
     字寫進同一個 `<style>` 字串裡，而說明文字本身又打了一次字面 `<style>`，結果 100% 復現同一
     bug；第二次改成純文字描述才 100% 修好（見 `jim_memory.md:37-40`）。這個 A/B 對照相當有說服
     力，我把可信度定為「機制敘事可能不是逐字精確，但因果關係已被獨立驗證」。同時我 grep 全站發
     現另有 14 個檔案用同一種 `<style>{\`...\`}</style>` 字面 JSX pattern（`FinalOnlyFrame.tsx`、
     `ai-recommendations/*`、`quant-strategies/page.tsx` 等），目前掃描零額外命中同款地雷，但沒有
     任何 lint/CI guard 防止未來在那些檔案重演同一手滑。
   - 建議：排一張小票加一個簡單 grep-based lint（或 CI 腳本）掃這 15 個檔案的 CSS 字串內容有無
     字面 `<style` / `<script` / `</style` / `</script` 子字串，防止同款地雷在姊妹檔案復發。

### 💭 Nits
1. 新 spec 用 `page.waitForTimeout(3000)` 固定等待，屬 magic number；regression-lock 用途下可接受，
   但若之後要擴大到 CI gate，建議換成更 deterministic 的 hydration-complete 訊號。

### ✅ Praise
- **除錯誠實度值得肯定**：作者主動揭露第一次修法自我遞歸重現同一 bug（把地雷寫進解釋地雷的說明
  文字裡），沒有藏起來直接報「修好了」，而是把整個過程記進 commit message 與 jim_memory，這正是
  團隊「不假綠」文化要的那種自我批判透明度。
- **diff 範圍紀律扎實**：獨立比對確認整個變更是逐位元組限定在 CSS 註解文字內（`/* ... */` 邊界完
  整、`._co-theme-name`/`._co-theme-tier` 兩條實際 CSS 規則字元完全未動、整檔僅這一處出現字面
  `<style>`），排除了「順手改了其他東西」的風險，視覺/資料零回歸的宣稱可信。
- **PR body 誠實揭露 3 個既有失敗 spec（session flake）**：而非默默忽略；且該分類（與本次純註解
  編輯結構性無關）站得住腳——一個只改 CSS 註解文字的 diff 不可能造成 auth/session 失效類的回歸，
  邏輯上不可能是本 PR 引入。

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（2 🟡 非阻擋，建議 fast-follow）

## 6. Suggested Owner for Fixes
- 🟡 #1（spec 未掛 `@smoke`）→ Jim（或 Bruce 決定是否納入 daily-prod-smoke）
- 🟡 #2（15 檔同款 pattern 掃描/lint guard）→ Jim / Elva 排下一輪

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-19
Sprint: W6 Day (2026-07-19 全站零錯誤走查)
