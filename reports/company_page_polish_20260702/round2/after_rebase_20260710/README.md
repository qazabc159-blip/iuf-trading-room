# PR #1160 — rebase onto origin/main 收尾（2026-07-10）

Round 2 桌面結構重排（K線＋五檔並排 64/36、HUD 統計條、section banner 統一）在 main
上掛了 8 天後 rebase，主要解衝突對象是期間新上的手機化系列（M2 #1181 / M3 #1190 / M5
#1198）與 #1200 的 globals.css 對齊。詳細衝突解法見 PR body / 本輪回報。

**注意**：7/3 原始 before/after 截圖（`reports/company_page_polish_20260702/round2/before/`
`.../after/`）在本次 worktree 未找到（git 歷史查證從未 commit 過，可能是先前 session 的
本機暫存檔已被清理）。本目錄只含這輪 rebase 完成後的驗證截圖，作為「rebase 沒破壞
Round 2 桌面佈局＋沒破壞後續 M2/M3/M5 手機修復」的證據。

## 截圖清單

- `desktop_1280_companies_2330_topfold.png` — 桌面 1280px 首屏：HUD 統計條（6 格：
  振幅/52週高/52週低/市值/本淨比/分K狀態）+ K線／五檔並排 trading view
- `desktop_1280_companies_2330.png` — 桌面 1280px 全頁 full-page
- `mobile_390_hud_strip.png` — 手機 390px HUD 統計條裁切（2 欄自動換行，M2/containment
  fix 的 `@media max-width:640px` 生效）
- `mobile_390_trading_view.png` — 手機 390px trading view 裁切（K線／五檔／逐筆改直向
  堆疊，非橫向並排）
- `mobile_390_financials_table.png` — 手機 390px 財報表裁切（M2 修復的卡片化持續有效，
  EPS/毛利率等欄位可見無需橫向捲動）
- `mobile_390_companies_2330.png` — 手機 390px 全頁 full-page

## 驗證方式

本機 `next start`（`NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`）+ 真 owner
session（railway `SEED_OWNER_*` → `POST https://api.eycvector.com/auth/login` →
`packages/qa-playwright/tests/auth.setup.ts` 產生 storageState）+ Playwright
`chromium.newContext({storageState})` 對 `/companies/2330` 截圖。同時跑了
`packages/qa-playwright/tests/mobile-390.spec.ts`（`mobile-iphone-13` project）全 13
route，含 `/companies/2330` case，13/13 PASS。
