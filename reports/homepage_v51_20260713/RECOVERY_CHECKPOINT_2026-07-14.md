# 首頁原封搬原稿 — 關機後接續 checkpoint（Elva, 2026-07-14 ~11:35 盤中）

## 「剛剛做到一半」是什麼（已從磁碟證據重建，零遺失）
- 楊董首頁美術打槍 6 輪，根因＝前 5 輪都在用 app 樣式系統（`.tac-*` class）**仿製**原稿，非真搬。
- 板上新決策（本人 7/14 定）：**原封搬原稿檔、獨立隔離（像交易室 iframe）、逐字 serve 66KB 原稿、只換資料 token 成真值/誠實 EMPTY，不看結構只疊圖驗美術**。楊董 7/14「繼續接續剛剛工作」＝approve 此做法。
- 11:22 我開了乾淨 worktree `home-exact/`（分支 `feat/homepage-exact-artifact-jim-20260714`，自 main `5fb56778`），正要開始搬就被自動關機打斷。worktree 乾淨零遺失。

## Ground truth 檔案位置（都撐過關機）
- 原稿逐字 HTML：`<session>/scratchpad/homepage_v51_artifact_source.html`（66077 bytes / 862 行）。本 session 已複製一份到 scratchpad。原始存於前 session `a2728470` scratchpad。artifact id `41de1bc9`。
- 舊仿製嘗試（放棄）：分支 `feat/homepage-v51-verbatim-jim-20260714` commit `d2cea682`（仍是 `.tac-*` 改 page.tsx+globals.css，非真搬，勿用）。

## 原稿結構地圖
| 行 | 內容 | 處置 |
|---|---|---|
| 1 | artifact frame-runtime 腳本 | 剝掉 |
| 3–339 | 真 `<style>`（amber 暗色主題＋全元件 CSS） | 逐字保留 |
| 342–350 | `.stage-head`/`.frames`（artifact 標題框） | 剝掉 |
| 355–651 | 桌面 `.device.desktop > .scroll > .mast+.sheet` | 保留 |
| 657–857 | 手機 `.device.mobile`（另一套手作 390 版面） | 保留 |

原稿手作桌面＋手機兩套版面。`.device.desktop{width:1280px;height:760px}` / `.device.mobile{width:390px}` / `.scroll{overflow-y:auto}` / `.device::after` CRT 掃描線。

## 做法（本輪執行中）
1. 切片組隔離靜態頁 → `apps/web/public/home-exact/index.html`（交易室同款 public 隔離位）。原 CSS 一 byte 不動，只加薄 override 中和裝置框（device 固定寬/捲動框）＋media query 切桌機/手機。
2. `/` route 用 iframe 崁 `/home-exact/index.html`（交易室 iframe 同 pattern）。
3. 資料 token（22,845.60 / 2330 +1.24% / 07/11 / 13:42:08 等）→ 頁內 vanilla JS 打既有 public API 填真值，缺料誠實 EMPTY。
4. Elva 疊圖驗美術（對 artifact 截圖），不看結構。差一塊退。

## 下一步（若再被打斷從這接）
- [ ] 靜態頁組出並本機 render 驗 SHELL 跟原稿一模一樣（demo 數字先原封）
- [ ] 資料 token 清單盤點＋接 API
- [ ] `/` route iframe 崁入
- [ ] full CI + Playwright + Elva 疊圖 → 收
