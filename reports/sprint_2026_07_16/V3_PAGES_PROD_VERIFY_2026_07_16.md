# 三頁 v3 上線 prod 終驗 — 2026-07-16（Bruce）

驗收對象：#1286（公司頁 v3，`e20e1f19`）+ #1287（登入/註冊 v3，`bafd1025`），同批合 main，
deploy via GHA push:main。楊董已 ACK 定稿放行實作（見 session_handoff 2026-07-16 段）。
驗收標準＝跟定稿一致 + 真功能不退化。全程唯讀＋僅登入動作，未送任何真/模擬委託單。

## 部署確認

- `bafd1025` deploy run `29496122787`：completed / success（7m36s，push@11:54:15 UTC → 完成 ~12:01:51 UTC）
- `e20e1f19` deploy run `29496119009`：completed / success（3m50s）
- web 內容標記法（不信 API buildCommit）：`/login` 頁源含 `authv3-login` 首見於 **12:01:24 UTC（20:01:24 台北）**；owner cookie curl `/companies/2330` 含 `co-v3-page` 同步在線。
- 暖機等待：10 分鐘（至 12:11:24 UTC / 20:11:24 台北）才截圖，符合鐵律。

## A. 登入頁 `/login`

| 項目 | 結果 |
|---|---|
| 1920 桌機截圖 vs 定稿 `login_redesign_v1.html`（同尺寸並排） | **PASS**（結構/字級/console 框/巨字標/建立帳號同框 CTA 完全一致） |
| 390 手機截圖 vs 定稿 | **PASS**（結構一致） |
| grep 頁源零「SIM/模擬」 | **PASS**（`login_1920_simword=false`；bodyText 全文人工核對零命中） |
| 錯誤密碼 → 真後端錯誤訊息 | **PASS** — 帶 owner email + 錯密碼送出，渲染「帳號或密碼錯誤。」（非假訊息，`.av3-err` 即時渲染），見 `login_error_state.png` |
| owner 帳密真登入成功導向 | **PASS** — 真登入 `SEED_OWNER_EMAIL`/`SEED_OWNER_PASSWORD` 成功後 `finalUrl=https://app.eycvector.com/`，見 `login_success_redirect.png`（首頁真資料：AI推薦5檔/每日簡報/S1量化策略/強勢排行全渲染，代表登入 session 真的落地） |

**唯一發現的並排可見差異**：定稿在「記住這台裝置」勾選同一行右側有「忘記密碼？」連結，**prod 版本沒有這個連結**（1920+390 皆確認缺）。查 commit diff 確認這是 Jim 刻意拿掉（無對應後端 forgot-password 功能，不做死連結，符合「不假掛」產品鐵律），非漏做，但楊董並排看**會**注意到這一點差異。

## B. 註冊頁 `/register`

| 項目 | 結果 |
|---|---|
| 無 `?invite=` → 邀請制占位卡態 1920+390 | **PASS**（`register_noinvite_hasGate=1` / `hasForm=0`；`.av3-gate` 卡片、邀請連結格式提示、返回登入 CTA 全在，見 `register_noinvite_1920.png`） |
| 帶假 `?invite=test-elva-verify` → 表單態 1920+390 | **PASS**（`register_invite_hasGate=0` / `hasForm=1`；姓名/信箱/密碼/確認密碼四欄位、密碼規則卡、常駐錯誤區皆在，見 `register_invite_1920.png`） |
| 密碼四規則即時勾選 | **PASS** — 填入 `AbcdefghijK9` 後 4/4 規則即時轉綠勾（`register_invite_passwordRulesMet=4`），見 `register_invite_1920_pwrules.png` |
| 送出 → 真後端「邀請連結無效」類錯誤 | **PASS** — `register_invite_submitErrorText="邀請連結無效或已過期，請聯繫邀請人。"`，渲染於常駐錯誤區（`.av3-err-persist`），見 `register_invite_error_state.png` |

## C. 公司頁 `/companies/2330`（owner session）

| 項目 | 結果 |
|---|---|
| 1920 全頁長圖 + 390 全頁長圖 | **PASS**（`companies_2330_1920_full.png` / `companies_2330_390_full.png`，滿版無空洞） |
| v3 區塊順序核對（DOM y 座標遞增） | **PASS** — 實測 `sec-kline`(604) < `sec-quote`(1622) < `sec-fin`(1816) < `company-knowledge`(2490) < `sec-chips`(3269) < `sec-detail`(4349) < `sec-news`(5401) < `company-ai-report`(6212) < `sec-theme`(6385)，逐一遞增，跟 commit e20e1f19 的 JSX 順序（hero→K線→五檔\|逐筆→財報7tab→圖譜pair→法人\|融資券→外資持股→成交明細→重大訊息→AI報告→主題受惠）完全對應；rail（公司主檔/頁面索引/資料源狀態）在 aside 內確認 |
| K 線＝既有引擎活的 | **PASS** — 點擊「週K」後 `interval` 從日K→週K 真的切換（`activeAfter` 含"週K"），圖表重繪為 2016-07-18～2026-07-16 519根週K 真資料，見 `companies_2330_kline_weekly.png` |
| 財報 7-tab 切換 | **PASS** — 財報/月營收/資產負債/現金流/估值/市值/股利 7 個 tab 逐一點擊皆能切換且渲染對應真資料表（最後停在股利 tab，31 筆真股利記錄，見 `companies_2330_fintabs_last.png`） |
| 數字非定稿假數 | **PASS（查證後排除誤判）**——首次全文比對命中 `69.52`/`4,426`（DESIGN_NOTES §三揭露的佔位值之一），追查後為法人持股比例(69.52%)、融資融券金額(4,426.8億)等**即時真資料**，兩次獨立 fresh curl 複測該兩數字皆已不在（值隨行情變動），且 Pete 審查已 grep diff 確認原始碼零硬編碼命中；**結論=巧合非洩漏** |
| AI 報告區＝既有面板 | **PASS** — 顯示「尚未生成 AI 分析報告」+「點此生成 2330 AI 分析」誠實態，見 `companies_2330_ai_report_panel.png`；**未點擊生成鈕**（依指示唯讀） |
| `/companies/3661`（上櫃樣本） | **PASS** — HTTP 200，無 Application error，滿版渲染真資料（法人 52.21%/47.78%、真融資券/真財報），見 `companies_3661_1920.png` |

**觀察（非阻擋）**：`/companies/2330` 與 `/companies/3661` 兩頁皆偵測到瀏覽器 console `pageerror`：React 錯誤 #418（hydration text mismatch）。追查 `BidAskPanel.tsx` 內用 `new Date().toLocaleTimeString()` 產生「更新於」時間戳，是本 PR**未改動**的既有元件（page.tsx 是 Server Component、JSX 只搬位置未重寫），此錯誤大機率為既有 pattern 非 #1286 引入的迴歸；頁面實際渲染正常、無視覺破圖、無 Application error。建議下一輪 QA spec 補 console-error 斷言鎖住（Pete #1287 review 也點名同類缺口），非本輪 blocker。

## D. 回歸快查

| 項目 | 結果 |
|---|---|
| `/` 未登入 → 導向 `/login` | **PASS** — `homepage_unauth_finalUrl=https://app.eycvector.com/login?next=%2F`，見 `homepage_unauth_redirect.png` |
| `/desk-exact` 正式交易室 route（owner session） | **PASS** — 無 Application error、零 pageError；header 真報價 2,470.00、自選 10/15 真值、五檔盤口真值、下單票價格動態 seed=2470.00、今日委託僅今日單，#1284 成果完整未被本批打壞，見 `desk_exact_regression_1920.png` |

## 結論（≤10 行）

1. **登入頁**：跟定稿高度一致，真登入/真錯誤訊息全通；唯一並排可見差異＝prod 拿掉了定稿的「忘記密碼？」連結（刻意，因無對應後端功能）。
2. **註冊頁**：兩態（無邀請/假邀請）皆跟定稿一致，密碼規則即時勾選、真後端「邀請連結無效」錯誤皆正確渲染。
3. **公司頁**：v3 區塊順序 byte-exact 對應 commit 意圖，K 線引擎活、財報 7-tab 活、AI 報告誠實空態、上櫃樣本不炸版；一度疑似的假數字（69.52/4,426）查證為巧合的即時真值非洩漏。
4. **回歸**：首頁未登入導頁正常、`/desk-exact`（#1284 成果）完全未受本批影響。
5. **楊董並排看會抓到的差異點**：僅 1 項——`/login` 缺「忘記密碼？」連結（定稿有、prod 無，桌機+手機皆同）。
6. **非阻擋觀察**：`/companies/*` console 有既有元件（BidAskPanel 時間戳）觸發的 React #418 hydration 警告，判斷非本輪 PR 引入、頁面渲染正常。

**是否可 deploy**：已 deploy 且驗證通過。**是否可宣告收口**：可以——兩 PR 皆 prod 實測 PASS，唯一差異點（forgot-password 連結）已誠實揭露供楊董裁決是否需要（技術上非缺陷，是刻意省略死連結）。

## 證據

截圖目錄：`reports/sprint_2026_07_16/v3_prod_verify/`（20 張：login/register/companies/desk-exact/homepage 全狀態 + 定稿並排對照 2 張）

## 驗證腳本（可重跑）

- `packages/qa-playwright/bruce_v3_login.mjs`
- `packages/qa-playwright/bruce_v3_register.mjs`
- `packages/qa-playwright/bruce_v3_company.mjs`
- `packages/qa-playwright/bruce_draft_shot.mjs`（本機定稿截圖，供並排比對用）

跑法：`cd packages/qa-playwright && SEED_OWNER_EMAIL=<owner email> SEED_OWNER_PASSWORD=<owner password> node bruce_v3_login.mjs`（register/company 腳本用既有 `storageState.json`，不需額外 env）。
