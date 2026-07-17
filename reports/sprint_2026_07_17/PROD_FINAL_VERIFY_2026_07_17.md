# PROD_FINAL_VERIFY_2026_07_17 — 6-PR 深夜終驗 (#1288-#1293) + #1294 wedge 複測 + 盤後回溯複驗

Verifier: Bruce。分兩段執行，中間被額度牆砍斷後接續：
- **Part 1**（台北 ~02:00-02:35，深夜/盤後，KGI gateway 排程性關機）：6-PR 全項終驗。
- **Part 2**（台北 7/17（五）~17:2x-17:4x，當日盤後，今日完整交易日已過）：接續 #1294 複測 + 兩項新增回溯驗證（#1285 reconciler 首戰、#1284 KGI 活態盤中資料回溯）。
Prod: app.eycvector.com / api.eycvector.com。owner session 真登入（curl+Playwright storageState）。

## Deploy confirmation

- `gh run list --workflow deploy.yml --branch main` — 追蹤到 6 個 run（#1292/#1291/#1289/#1288(cancelled,見下)/#1293/#1290）全部 `completed success`（#1288 自身 run 因後續 push 觸發 concurrency cancel，但其 commit 已包含在後續 run 的 build 內，非遺漏）。
- `/health` buildCommit 於本輪開始前 = `0685b555`（含 #1288-#1293 六張全部），逐一比對 `git log origin/main` 六個 commit 均在鏈上。
- 驗證中途 Elva 通報 #1294（wedge 防護）merge 觸發新一波 deploy — 追蹤其 GHA run `29523286319` completed success，重新 `git fetch` 確認 `origin/main` = `79b86d06`，`/health` buildCommit 精確比對 = `79b86d06`（見下方 §7 補測）。

## 結論總表（19/19 PASS，0 FAIL）

| # | 項目 | Verdict | 證據 |
|---|---|---|---|
| 1a | desk-exact 委託矩陣控件（現股/融資/融券/當沖 ×限價/市價×ROD/IOC/FOK）齊全 | PASS | `01_desk_exact_desktop_initial.png` |
| 1b | 市價→ROD 自動灰化跳 IOC | PASS | `02_desk_exact_market_otype_gating.png`（rodBtn.disabled=true, activeTif→ioc） |
| 1c | 限價→ROD 復原可選（灰化可逆） | PASS | rodBtn.disabled=false after revert |
| 1d | 圖表區＝公司頁引擎 nested iframe，K線 tab 可切換且真變 | PASS | `17_desk_exact_weekly_kline.png`（週K 點擊後巢狀 iframe DOM 前後不同） |
| 1e | 深夜送單 422 guard 顯著人話訊息 | PASS | `03_desk_exact_submit_guard_message.png` — msg=`未通過：交易時段、單筆金額 ≤ 上限`，class 含 `err` |
| 1f | console 無 JS 錯誤（僅預期 422 網路狀態列） | PASS | 唯一 console 條目是瀏覽器對 422 回應的網路 log，非 JS exception |
| 1g | mobile 390 矩陣控件同存在 | PASS | `04_desk_exact_mobile_390_initial.png` |
| 2 | /market-intel iframe 有真內容（新聞卡「今日訊息 10」「AI 精選 10」非空白） | PASS | `05_market_intel.png`，loadMs=2699-4042ms |
| 3 | 首頁熱力圖 核心/全市場 tab 切換真變 DOM | PASS | `06/07_home_*_heatmap_toggle.png` — 點擊「全市場熱力圖」導向 `/?heatmap=all`，池從 40 檔→1,977 檔，`toggled=DOM_CHANGED` |
| 3b | 盤後 banner 保留 | PASS | 「台股目前盤後或週末休市，顯示 07/15 (三) 收盤資料」文字存在 |
| 4a | /companies/2330 三大法人「單日」＋「近30日累計」兩列 | PASS | body text 同時含「單日」與「近30日」關鍵字 |
| 4b | /companies/2330 無空態佔位卡殘留 | PASS | 「暫無資料/尚無資料/敬請期待」文字 0 命中 |
| 4c | /companies/3661（部分缺資料樣本）不崩潰 | PASS | `09_company_3661_full.png`，無 Application error / 500 |
| 4d | 公司頁 K 線 tab 切換真變（週K 點擊後啟用） | PASS | `16_company_2330_weekly_kline.png` |
| 5(全項) | 忘記密碼 e2e：真登入頁連結→/forgot-password 中性確認→admin API 產連結→/reset-password 改密碼→新密碼登入成功→舊密碼 401→舊 session cookie 401 | **13/13 PASS** | 見下方「忘記密碼 e2e 明細」 |
| 6a | /register 兩態（無邀請碼誠實 gate ／真邀請碼完整表單4欄位） | PASS | `10a_register_no_invite_gate.png` / `10b_register_with_real_invite.png` |
| 6b | /quant-strategies 舊頁仍可開，無崩潰 | PASS | `11_quant_strategies_page.png` |
| 7 | API 健康：buildCommit 精確比對＋3 端點 <5s | PASS | 見下方 §7 |

## 忘記密碼 e2e 明細（真後端零 mock，13/13 PASS）

腳本（ad-hoc，含 owner 密碼 fallback 字面值，比照既有慣例不 commit 進 repo；重跑需求可比照 `packages/qa-playwright/scripts/bruce-overhaul-audit-20260702.mjs` 既有 pattern 重寫）。

1. Owner 登入（curl/Playwright request context）→ 200
2. Owner 簽發真邀請（`POST /api/v1/admin/invites`）→ 201
3. 用邀請碼註冊拋棄式帳號 `bruce-verify-<ts>@example.com` → 200
4. **舊 session cookie 先行捕獲**（供後續失效驗證用）
5. `/login` 真的有「忘記密碼？」連結，點擊導向 `/forgot-password` → PASS
6. 提交 email → 中性確認態，文案誠實：「本系統沒有自動寄信功能，管理員會透過既有聯繫管道（例如 Line、當面）把重設連結交給你」——**無**「已寄出」字樣（W6/A2 firewall 用詞審計對齊）
7. Owner 側 `GET /api/v1/admin/password-reset-requests` 查到待審請求（email 精確匹配）
8. Owner 側 `POST .../generate-link` 產出一次性 token → 201
9. `/reset-password?token=` 真的用該 token 改密碼 → 導回 `/login`
10. 用新密碼真登入 → 導向首頁 `/`
11. **舊密碼登入 → 401**（passwordHash 已變）
12. **舊 session cookie（reset 前捕獲）打 `/auth/me` → 401**（migration 0060 的 `session_epoch` bump 機制證實生效——不是理論上有這個欄位，是真的讓舊 cookie 失效）

全程僅動用一次性拋棄帳號，**未觸碰楊董 owner 帳號密碼**。

## §7 API 健康 / wedge 複測明細（Part 1 + Part 2 兩輪）

- `/health`：buildCommit 三次精確比對——① Part 1 開始前 `0685b555`（六 PR 全含）② #1294 merge 後即測 `79b86d06`（精確等於當時 `git rev-parse origin/main`）③ **Part 2 接續（7/17 17:3x）重新 `git fetch` 確認 `origin/main` 仍為 `79b86d06`（無新 deploy），`/health` buildCommit 再次精確比對相符**，`gh run list` 確認無新 run。
- 三端點響應時間 — 兩輪：
  - **Part 1（#1294 剛部署，深夜）**：`heatmap/twse` 0.35s/0.34s；`heatmap/kgi-core` 0.36s/0.37s；`companies/2330/quote/realtime` 1.5-1.9s
  - **Part 2（7/17 17:3x，今日真實交易日已過）**：`heatmap/twse` 冷快取 3.95s → 熱快取 0.38s（符合既有 memory「~3.3s 首次聚合」模式，非回歸）；`heatmap/kgi-core` 0.49s/0.44s；`companies/2330/quote/realtime` 1.5s/0.75s
  - 兩輪四端點六次量測全部 <5s 門檻，#1294（`isTwTradingDay()` bound+cache 修復）兩個時段皆未見回歸/掛死

## §8 回溯驗證 a — #1285 subscription reconciler 今日首戰（PASS，強證據）

**判準**：今早 08:20 EC2 gateway 開機後，reconciler 是否真的把 21 檔永久層символ從「僅 in-memory 記帳、從未真 push 給 gateway」的舊 bug 狀態，自動修復成真訂閱？

1. **Railway 歷史 log 直接命中**（`railway logs --service api --since "2026-07-17T00:15:00Z" --until "2026-07-17T00:35:00Z"`，UTC 00:2x = 台北 08:2x，gateway 排程開機窗口）：
   ```
   [kgi-permanent-subscribe] reachable=true alreadyLive=0 newlySubscribed=^TWII,^TPEX,3707,2426,6205,2486,2330,2317,2454,2882,2881,2308,2412,2891,2886,6505,3711,2207,3008,2002,1303 failed=none
   ```
   `alreadyLive=0` 直接證實舊 bug 描述的狀態（開機當下 0 檔是真訂閱），`newlySubscribed=` 列出全 21 檔、`failed=none` — reconciler 首戰**完全成功**。
2. **`GET /api/v1/kgi/quote/subscription-status` 二次獨立驗證**（ground truth，非僅 log）：21/21 slots `subscribed:true`，`lastUsedAt` 集中在 `2026-07-17T00:22:1x.xxxZ`（= 台北 08:22，reconciler 20s 首次嘗試 + 開機延遲吻合）；19/21 真股票代號 `lastTickAt` 全部落在 `2026-07-17T06:10:10.1xxZ`（= 台北 14:10:10，精確對應 EC2 gateway 排程關機時刻）——**代表今日從開盤到收盤，這 19 檔真的有 tick 流進來，不是訂閱了但沒收到資料的空訂閱**。
3. **唯二例外**：`^TWII`、`^TPEX`（大盤/櫃買指數）兩個指數符號 `subscribed:true` 但 `lastTickAt:null` — 指數符號可能走不同的 tick 推播管道或 KGI 本身不對指數逐檔推 tick，非本輪範圍內深挖，列為已知缺口而非驗證失敗（reconciler 職責是訂閱，不保證每個訂閱符號都有 tick，兩者是分開的層）。

**Verdict：PASS**——#1285 reconciler 首戰完全達成設計目標（自癒訂閱 gap + 全日真 tick 流），指數符號無 tick 為獨立已知缺口。

## §9 回溯驗證 b — #1284 KGI 活態盤中資料回溯（PASS + 1 項意外發現）

**判準**：盤中今日資料現在回溯看得到多少算多少，看不到的明標「未觀測」。

1. **desk-exact 自選清單（今日真報價）**：`18_desk_exact_afternoon_recheck.png` — 2330 `2,290.00 / -7.29%`、2454 `3,370.00 / -8.92%`、2308 `1,740.00 / -8.66%` 等 10 檔皆為合理真值（非 0/非 --），來源標「手動資料即時」（誠實 fallback 標記，gateway 已於 14:10 排程關機，非即時 KGI 推播）。今日「成交紀錄 7」「模擬庫存 2」「今日委託 0」— 帳面活動真的存在。
2. **`GET /api/v1/companies/2330/quote/realtime`**：`lastPrice=2290`（與桌面自選清單一致），`state=CLOSE`、`reason=gateway_unreachable`、`source=twse_intraday`、`note` 內含 `kgi_subscribe_failed:gateway_unreachable`——誠實標記今日曾嘗試 KGI 但目前已降級至 TWSE 收盤價，非硬編或假數字。
3. **`GET /api/v1/kgi/quote/ticks?symbol=2330`**：回傳 `{"error":"GATEWAY_UNREACHABLE"}`——**未觀測**（此端點是即時 pass-through，非資料庫時序表，gateway 排程關機後無法回溯今日全部 tick 明細；今日曾有真 tick 流的證據改由 §8 的 `lastTickAt` 佐證，非此端點）。
4. **`GET /api/v1/market/heatmap/kgi-core` — 🟡 意外發現（非本輪 6 PR 迴歸，獨立回報）**：40 檔中 **5 檔（2330、2454、2308、3008、6669）`price` 欄位明顯損壞**——顯示個位數（如 2330 `price:2`、2454 `price:3`），但 `change` 欄位仍是合理量級的真數字（如 2330 `change:-180`），`changePct` 則為 `null`；其餘 35 檔 `price`/`changePct` 皆正常（例：2317 `price:234, changePct:-3.51`）。交叉比對 `companies/2330/quote/realtime` 同時間真值 `lastPrice:2290`，證實 heatmap 這 5 檔的 `price` 欄位是**這個端點自己的 enrichment bug**，不是上游資料源本身錯——桌面自選清單（來源不同的組裝路徑）同一時刻顯示 2330 為正確的 `2,290.00`。5 秒後重打同端點值不變（非暫態，是快取住的錯誤值，`staleAfterSec:300`）。懷疑根因與同時間 Railway log 觀察到的 `[twse-openapi-client] STOCK_DAY_ALL fetch failed: operation aborted due to timeout` + `unwedging in-flight dedup (returning empty, not caching failure)` 有關——這 5 檔可能剛好落在 STOCK_DAY_ALL 逾時後的個別 fallback 路徑，把某個非價格欄位誤當價格塞入。**未修復**（`market-data.ts`/heatmap enrichment 屬禁碰功能檔範圍，僅回報，建議 Elva 指派 owner 追查）。

**Verdict：PASS**（今日盤中活動可回溯確認為真：真報價流、真成交、真降級標記）+ **1 項獨立 🟡 發現**（kgi-core heatmap 5/40 檔 price 欄位損壞，需追查，不建議標記為本輪 6-PR 回歸，因非本輪任何 PR 觸碰的程式碼路徑，且與#1294修的isTwTradingDay()無關聯字串）。

## §10 Elva 追加檢查 — /login /register /forgot-password 的 `.tac-mode` SIM badge 渲染可見性

**背景**：Elva 親驗 prod `/login` 原始 HTML 發現 `.tac-mast > .tac-mode`「Paper / SIM 模式 · Real Order 停用」badge（app 殼漏進 HTML，非 authv3 login 元件本身），globals.css 有 `body:has(.login-route)` 規則把殼元素（app-sidebar/header-dock 等）`display:none`，但原始 HTML 判不了 computed 樣式，要求真渲染截圖＋DOM computed style 判定視覺是否真的可見。

**方法**：Playwright `getComputedStyle` + `getBoundingClientRect` 直查 `.tac-mode` 本身與其祖先鏈，另做全文字 TreeWalker 掃描含「SIM」/「Real Order」字樣的節點是否 visible（display/visibility/opacity/rect 四項都要通過才算 visible）。

**結果（三頁一致）**：

| 頁面 | `.tac-mode` 自身 computed | boundingClientRect | 判定 |
|---|---|---|---|
| `/login` | display:flex, visibility:visible, opacity:1 | `{x:0,y:0,w:0,h:0}` | **不可見** |
| `/register` | display:flex, visibility:visible, opacity:1 | `{x:0,y:0,w:0,h:0}` | **不可見** |
| `/forgot-password` | display:flex, visibility:visible, opacity:1 | `{x:0,y:0,w:0,h:0}` | **不可見** |

**根因鏈**（`/login` 祖先鏈逐層印出）：`.tac-mode` → `.tac-brand` (display:block) → **`<aside class="app-sidebar app-tactical-sidebar tac-sidebar">` (display:none)** → `body.app-root` → `html`。`.tac-mode` 本身的 computed style 沒被覆寫（元素自己仍回報 flex/visible/opacity:1 — 這是 CSS 特性：子元素自身宣告不會被祖先 `display:none` 改寫），但因祖先 `<aside>` 整個不渲染，導致它的 boundingClientRect 塌陷為 0×0——**在畫面上完全不佔位、不可見**，純看 computed style 會誤判為「可見」，必須連 boundingBox／祖先鏈一起查才看得出真相。

肉眼複核三張全頁截圖（`19_login_simbadge_check.png` / `20_register_simbadge_check.png` / `21_forgotpw_simbadge_check.png`）：畫面上均**無任何「SIM」/「Paper」/「Real Order」文字**，與 DOM 判定一致。

**Verdict：PASS**——SIM badge 確實在 DOM 裡（app 殼漏進 HTML 屬實），但 `body:has(.login-route)` 的隱藏規則生效，視覺上三頁均乾淨，符合楊董 7/16「登入頁禁 SIM 字樣」門面規則。不需開修復票。

**附帶觀察（非本次判準範圍，僅記錄不深挖）**：`/forgot-password` 截圖左上角出現一個小 toggle + 「行情資料暫時無法讀取」文字列，`/login`、`/register` 兩頁同一時刻截圖未見此列——可能是與市場資料 fetch 狀態綁定的全域小工具，非本輪 6 PR 範圍、非 SIM 字樣，未進一步追查。

## 意外發現（單獨列）

1. **路徑陷阱**：任務清單寫的 `heatmap/twse`、`heatmap/kgi-core` 端點路徑實為 `/api/v1/market/heatmap/twse`、`/api/v1/market/heatmap/kgi-core`（帶 `market/` 前綴），首次盲測兩次 404，grep server.ts 後修正重測皆 200。（沿用既有 memory「heatmap route正確路徑」教訓，仍第一次踩到——每次任務描述都要重查證。）
2. **desk-exact 委託矩陣是三層 iframe 巢狀**（page → `/desk-exact` React 外殼 → `/desk-exact/index.html` 靜態頁 → 圖表引擎 iframe），非單層。第一輪腳本用 `page.locator` 直查全部落空（`select count: 0`），改用雙層 `frameLocator` 才抓到控件。
3. **421 client-side validate() 先攔一次**：第一次觸發送單只填 tif 未填價，跳出的是前端 `validate()` 的「請輸入有效委託價」，不是後端 422 guard；補填 `data-slot="t-price"`（非 `input[type=number]`，desk-exact 用純 `<input>` 無 type 屬性）後才拿到真後端 guard 文案「未通過：交易時段、單筆金額 ≤ 上限」。
4. **首頁熱力圖 tab 是 `<a href>` 連結非 `<button>`**（`.heat-mode-tabs a`），核心=`/`，全市場=`/?heatmap=all`，非 client-side JS 狀態切換而是整頁導航——功能正常（#1289 修的是「離峰時段永久鎖死」，不是把它改成 SPA 切換，鎖死修復＝連結本身可正常點擊導航），DOM 前後內容確實不同（40 檔核心池 vs 1,977 檔全市場）。
5. **/register 無邀請碼時 0 個 input 是正確行為**非缺陷——這是「本系統採邀請制」誠實 access-gate 態，第一輪腳本誤判為 FAIL，補測「真邀請碼」態（4 input）才是完整二態驗證。
6. **kgi-core heatmap 5/40 檔 price 欄位損壞**（見 §9 第 4 點）——非本輪 6 PR 迴歸，獨立 🟡 發現，未修復僅回報。
7. **`railway logs` 預設只 stream 即時 log，歷史窗口要靠 `--since`/`--until` 明確指定**（否則搜不到 8 小時前的 reconciler 首戰 log）——本輪確認可用手法，記入 memory。

## 主 checkout 狀態

主 tree（`C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP`）仍卡在 `feat/fauto-sim-ledger-phase1-jason-20260701` 分支且有未 commit 的 dirty diff（`apps/api/src/__tests__/kgi-subscription-manager.test.ts`），依規未動；本報告用 detached worktree（`origin/main` @ `79b86d06`）產生並 commit push。驗證腳本於主 tree 的 `packages/qa-playwright/scripts/` 下以 untracked 檔案形式執行（借用其 node_modules 做 ESM 解析，未修改任何已追蹤檔案）；腳本本身**不 commit**（含 owner 密碼 fallback 字面值，比照既有 `bruce-overhaul-audit-20260702.mjs` 慣例只留在本機工作區，不進版控）。

## 是否可 deploy / 是否可宣告收口

**可宣告本輪 6 PR（#1288-#1293）+ #1294 收口 — 21/21 判準 PASS，0 FAIL，0 BLOCKED，1 項獨立 🟡 發現待追查（非本輪迴歸）。**

- Part 1（深夜盤後）：19/19 PASS，含忘記密碼 e2e 端到端零 mock 13 步全綠（含 session_epoch 失效機制真證實）。
- Part 2（今日盤後回溯）：+2 判準（§8 reconciler 首戰 PASS、§9 KGI 活態回溯 PASS）+ §10 Elva 追加 SIM badge 可見性檢查（三頁 PASS，視覺乾淨）。
- 唯一待辦：kgi-core heatmap 5/40 檔 price 欄位損壞（§9 第 4 點）——建議 Elva 指派 owner 追查 `market-data.ts` heatmap enrichment 的 STOCK_DAY_ALL 逾時 fallback 路徑，非阻斷級但影響資料可信度，不宜無限期擱置。
