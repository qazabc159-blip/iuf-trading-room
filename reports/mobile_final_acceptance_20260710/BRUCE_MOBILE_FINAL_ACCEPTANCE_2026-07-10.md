# 手機版徹底完工最終驗收 — Bruce（2026-07-10，含盤中補驗）

驗證環境：prod `https://app.eycvector.com` / `https://api.eycvector.com`，SEED_OWNER 真 session（cookie
`iuf_session`，經 `POST /auth/login`）。**本報告分兩段驗證**：第一段 2026-07-10 00:0x-00:2x TST
（盤後，main HEAD `5d0d63cc`，#1197 已含）；第二段（§6）2026-07-10 09:2x-09:3x TST（**盤中**，main
HEAD `origin/main 36ce751b`，#1198 已含且已確認 prod 部署）。

驗證入口（可重跑）：`packages/qa-playwright/tests/bruce_mobile_final_acceptance_20260710.spec.ts` +
既有 `mobile-390.spec.ts` + `jim_mobile_m4_portfolio_shell_20260709.spec.ts`。指令：
```
cd packages/qa-playwright
IUF_QA_WEB_BASE_URL=https://app.eycvector.com IUF_QA_API_BASE_URL=https://api.eycvector.com \
SEED_OWNER_EMAIL=<owner email> SEED_OWNER_PASSWORD=<owner pw> \
IUF_QA_REPORT_DIR=$(pwd)/../../reports/mobile_final_acceptance_20260710 \
npx playwright test tests/auth.setup.ts tests/mobile-390.spec.ts tests/jim_mobile_m4_portfolio_shell_20260709.spec.ts tests/bruce_mobile_final_acceptance_20260710.spec.ts
```

7/10 盤中補驗（§6）新增三支，同一組 env var，`--project=desktop-chromium`：
```
npx playwright test tests/auth.setup.ts \
  tests/bruce_mobile_intraday_reverify_20260710.spec.ts \
  tests/bruce_paper_order_1share_20260710.spec.ts \
  tests/bruce_kgi_channel_status_20260710.spec.ts \
  --project=desktop-chromium
```

## 1. 全站 390px 掃描

| 頁面 | 結果 | 證據 |
|---|---|---|
| 首頁 `/` | PASS | `mobile390___mobile-iphone-13.png` |
| AI 推薦 `/ai-recommendations` | PASS | `mobile390__ai-recommendations_...png` |
| 警示 `/alerts` | PASS | `mobile390__alerts_...png` |
| 公司頁 `/companies/2330` | PASS | `mobile390__companies_2330_...png` |
| 主題頁 `/themes/inp`（磷化銦） | PASS | `bruce_mobile390__themes_inp_...png` |
| 訊號 `/signals` | PASS | `bruce_mobile390__signals_...png` |
| 量化策略 `/quant-strategies`(+detail) | PASS | `mobile390__quant-strategies*...png` |
| 績效記帳 `/track-record` | PASS | `mobile390__track-record_...png` |
| 複盤 `/reviews` | PASS | `mobile390__reviews_...png` |
| 設定中心 `/settings`(+account/broker/subscription) | PASS（4/4） | `mobile390__settings*...png` |
| 交易台 `/portfolio`（父層殼，390px 無橫向溢出） | PASS | `bruce_mobile390__portfolio_...png` |
| `/portfolio` iframe 內券商列真點擊（非 force） | PASS | `bruce_mobile390_portfolio_iframe_click_verified_...png`（KGI 按鈕真點擊後 toggle `active` class） |

判準：`document.documentElement.scrollWidth <= clientWidth + 1px` 且無 blocking console error（401/403/500/
Application error/TypeError 等）且路由關鍵元素可見。共 13 條路由（含 portfolio 兩支）全數 PASS，全部
真 Playwright chromium 390×844，非目測。

## 2. /portfolio 中間帶抽查（995px，981-1000px 帶）

**FAIL — 發現真 P1 缺口，非測試假警報。**

- 直接測 995px：sidebar 高度 **717.97px**，iframe 只拿到 **182.03px**（900px 高視窗）。
- 寬度掃描定界（975/980/981/995/1000/1001px）：
  | viewport | sidebar 高 | iframe 高 |
  |---|---|---|
  | 975px | 129.9px | 770.1px（OK，緊鄰 980 下緣） |
  | 980px | 129.9px | 770.1px（OK） |
  | **981px** | **718.0px** | **182.0px（壞）** |
  | **995px** | **718.0px** | **182.0px（壞）** |
  | **1000px** | **718.0px** | **182.0px（壞）** |
  | 1001px | 900px（桌面 fixed aside） | 900px（桌面版正常） |

**根因**（已用 CSSOM 逐條規則列舉 + getComputedStyle 交叉確認，非猜測）：`FinalOnlyFrame.tsx` 的
click-blocking-overlay 修復用 `@media (max-width: 1000px)` 把 `.app-sidebar` 強制
`position:static !important; height:auto !important`（解決了 M4 的「疊在 iframe 上面擋點擊」問題，
這條在 390px/981-1000px 都正確生效，無 overlay/click-interception）。但 sidebar 內容本身收合成
「橫向緊湊 nav 條」的規則在 `globals.css` 是 `.app-tactical-sidebar.tac-sidebar { @media (max-width: 980px) }`
—— **兩個斷點不一致（1000px vs 980px）**。981-1000px 這個 20px 窄帶內：外層容器不再 overlay（M4 修復
有效），但內層 nav 仍是展開的完整垂直清單（自然高度 718px），把 iframe 擠壓到只剩 182px（900px 視窗
的 20%），使用者要滾動近 720px 才能看到交易台實際內容。**不是點擊被攔截，是可用空間被壓縮到需要
大量捲動才可用**，仍違反「sidebar 不得全螢幕覆蓋」的驗收標準。

- 證據截圖：`bruce_995_portfolio_sidebar_check_desktop-chromium.png`（可見 sidebar 完整項目清單佔滿
  視窗上方 80%，交易台內容被壓到底部）
- 重現步驟：Chromium viewport 995×900 → `GET /portfolio`（owner session）→ 等待 iframe visible + 1s →
  量測 `.app-sidebar` / `.iuf-final-content-frame` boundingClientRect
- 建議修法（非本人越權修改，僅供 Jim 參考）：`FinalOnlyFrame.tsx` 的 `@media (max-width: 1000px)` 改成
  `@media (max-width: 980px)` 對齊 `globals.css` 既有斷點；或反過來把 `globals.css` 的
  `.app-tactical-sidebar.tac-sidebar` 收合斷點改到 1000px 對齊 FinalOnlyFrame——兩者對齊其中一個方向
  即可消除這條 20px 死帶。

## 3. watchlist POST e2e

**PASS（API + UI 雙路徑）**

- API 路徑：`POST /api/v1/watchlist {symbol:"2330"}` → 200 → `GET /api/v1/watchlist` 確認 2330 在列 →
  `POST /api/v1/watchlist/remove {symbol:"2330"}` → 200 → `GET` 確認已移除。全程乾淨往返，測試資料已
  清理，prod 資料庫無殘留。
- UI 路徑：`/themes/inp` 主題成員列「加觀察」按鈕（4971 理宇-KY）真點擊 → 文案變為「已加入」（toHaveText
  斷言 PASS，非目測）→ 截圖 `bruce_watchlist_ui_added_desktop-chromium.png` 可見綠色「已加入」態 →
  已透過 API 清理殘留測試資料。

## 4. 統一下單流 prod 冒煙（paper channel）

**PASS（盤後預期 BLOCKED，訊息為中文、非裸 error）**

- `/portfolio` 桌面 1280px，付出 2s 等待 hydration → 點擊 `#submit-btn`（真點擊，非 force）→ 4s 後
  gate 區文字：**「紙上單未通過」**（送出鈕文案：「送出模擬訂單 紙上單未通過 平台鎖單」），限制項目列出
  「流通性、交易時段、風控限上限、單一部位上限」（全中文、對照 Jim 7/9 PR-3 驗證記錄的「未通過：
  交易時段」屬同一族產品級詞彙映射，非後端原文如 `Blocked by trading_hours.`）。
- 斷言：gate/label 組合文字通過「不含 Error/undefined/NaN/[object/TypeError/stack trace」的
  regex 檢查 PASS；文字非空 PASS。
- KGI channel：broker strip 上「凱基 KGI」徽章顯示「未配對」（gatewayStatus=unpaired，符合盤後
  gateway 關閉的預期狀態，中文徽章非裸狀態碼）。**未強制送 KGI SIM 單**（盤後 gateway 關閉、如任務指示
  不強求）。
- 證據：`bruce_order_flow_paper_before_submit_desktop-chromium.png` /
  `bruce_order_flow_paper_after_submit_desktop-chromium.png`

## 5. 桌面回歸抽查（1280px）

**PASS（3/3，截圖比對無版面破圖）**

- 首頁戰情台 `/`：`bruce_desktop1280___desktop-chromium.png` — KPI/AI 推薦/熱力圖/簡報/交易環境/工作流
  全部正常渲染，無版面碎裂。
- 交易台 `/portfolio`：`bruce_desktop1280__portfolio_desktop-chromium.png` — 桌面版三欄式佈局
  （sidebar 252px 固定 + K 線主欄 + 委託預覽欄）正常，無 M4/995px 那條窄帶問題（1280 > 1000 桌面斷點）。
- 績效記帳 `/track-record`：`bruce_desktop1280__track-record_desktop-chromium.png` — NAV 曲線/週次表/
  統計檢定說明正常。

## 缺口清單

| 級別 | 項目 | 重現步驟 | 建議 owner |
|---|---|---|---|
| ~~P1~~ **已修（見下方 7/10 盤中補驗 §6）** | ~~`/portfolio` 981-1000px 窄帶：sidebar 內容未收合，佔視窗 ~80% 高度，交易台需大量捲動才可見~~ | ~~Chromium viewport 995×900 → `/portfolio`（owner session）→ 量測 `.app-sidebar` height（718px）vs `.iuf-final-content-frame` height（182px）~~ | Jim（#1198 已對齊斷點，7/10 盤中對 prod 重掃 6/6 PASS） |
| P1（新發現，非手機/非 #1198 相關） | 全通道（paper + kgi）盤中送單皆卡在報價閘門：所有主要個股 quote source 皆退化到 `manual`（priority 1），kgi/tradingview/paper 皆 0，導致 `paper.safe=0`、`execution.safe=0` 全面掛零 | 盤中任一時段 `GET /api/v1/market-data/decision-summary?symbols=<10檔主要股>` → `summary.paper.safe=0/10` 全軍覆沒；根因 `GET /api/v1/kgi/status` 的 `gateway_quote_auth.errorCode=KGI_QUOTE_AUTH_UNAVAILABLE`（沿用 6/2 舊病）+ TradingView webhook 未活躍 + paper 自身報價源 0 | Jason（`market-data.ts`/`risk-engine.ts`，Bruce 權限外不可碰；建議先讓 KGI SIM 帳號補辦 Quote 訂閱授權，見 memory `memory_kgi_quote_auth_unavailable_20260602.md`） |

無 P0（無點擊被攔截 / 無資料寫壞 / 無盤中可能出現的阻斷）。無 P2 額外發現。**新 P1 不是手機化缺口，也不是 #1198 造成，是既有的全通道報價品質缺口，7/10 盤中首次被本輪驗證直接證實會擋下所有下單嘗試（不分 paper/kgi、不分委託大小）。**

## 未查證 / 受環境限制未驗到的項目（誠實列出，7/10 盤中補驗前的原始記錄）

- **KGI SIM channel 實際送單成功畫面**：本輪驗證在盤後（gateway 關閉，broker strip 顯示「未配對」），
  依任務指示不強求送單；KGI channel 的「成功送單→委託回報→成交」全鏈路仍需等下一個交易日盤中
  （08:20-14:10 TST gateway 開啟窗）才能補驗。
- **paper channel 在盤中真正 accepted 的畫面**：本輪只驗到盤後被風控擋（符合預期），未驗到盤中送出
  成功、委託表出現真實掛單列的畫面——這條需要下一個交易日盤中窗口補驗。
- 排除以上兩點外，本報告所有 PASS/FAIL 皆為本輪 prod 實測結果，非推測、非援引他人未見證的口頭陳述。
- **後續更新（見 §6）**：7/10 盤中窗口實際補驗後發現，這兩項未查證項目不是單純「等盤中窗口」就能
  轉綠——盤中確實補驗到了，但補驗到的是「全通道報價閘門擋單」這個更深層的既有缺口，見下方 §6。

## 6. 7/10 盤中窗補驗（本輪新增，收掉上方兩項未查證）

驗證時間 2026-07-10 09:2x-09:3x TST（**盤中**，KGI gateway 開啟窗 08:20-14:10 內；SEED_OWNER 真
session，同一組 owner cookie）。main HEAD at verify time：`origin/main 36ce751b`（#1198 已含，已確認
prod `startedAt=2026-07-09T16:48:30.609Z` 晚於 #1198 merge 時間 16:46:15Z，deploymentId
`64754b2d-a7f9-4fae-96f6-5c0bfe82a3be`）。

驗證入口（新增，可重跑）：
- `packages/qa-playwright/tests/bruce_mobile_intraday_reverify_20260710.spec.ts`（981-1000px 寬度掃描）
- `packages/qa-playwright/tests/bruce_paper_order_1share_20260710.spec.ts`（paper channel 2330 零股 1 股 UI 送單）
- `packages/qa-playwright/tests/bruce_kgi_channel_status_20260710.spec.ts`（kgi channel 送單訊息形狀）

### 6.1 981-1000px 死帶重掃 — **PASS，P1 收口**

寬度掃描 975/980/981/995/1000/1001px（與昨晚同一組定界點），全部 6 個寬度 PASS：

| viewport | sidebar 高 | iframe 高 | 判定 |
|---|---|---|---|
| 975px | 129.89px | 770.11px | PASS（收合） |
| 980px | 129.89px | 770.11px | PASS（收合） |
| **981px** | **129.89px** | **770.11px** | **PASS（昨晚 718.0/182.0 壞值，今日已修）** |
| **995px** | **129.89px** | **770.11px** | **PASS（昨晚 718.0/182.0 壞值，今日已修）** |
| **1000px** | **129.89px** | **770.11px** | **PASS（昨晚 718.0/182.0 壞值，今日已修）** |
| 1001px | 900px（桌面 fixed aside） | 900px | PASS（桌面版正常，不變） |

975-1000px 全帶一致收合（sidebar 129.89px / iframe 770.11px），與 #1198 的修法（sidebar-collapse 斷點
980→1000px 對齊 `FinalOnlyFrame.tsx` 既有 1000px overlay-disable 斷點）完全吻合，20px 死帶消失。
**此項可正式對楊董宣告「徹底完工，非部分」。**

### 6.2 paper channel 盤中送單 — **BLOCKED_QUOTE_SOURCE_DEGRADED（非預期的 P1，非手機缺口）**

任務要求「2330 零股 1 股」小額測試單。UI 真實操作（切「股」單位、數量填 1）+ 真點擊 `#submit-btn`：

- 結果：`labelText="紙上單未通過"` / `gateText="報價檢查未通過，暫不能送出委託"`（全中文、非裸 error，
  斷言通過）。
- **與昨晚盤後的差異**：昨晚盤後擋單原因是「交易時段」（`trading_hours` guard，符合盤後預期）；今天
  盤中同一顆股票同一份小額委託被擋，原因完全不同——是**報價閘門**（quoteGate.blocked），不是交易時段。
- 直接對 API 覆核（`POST /api/v1/trading/orders`，accountId=`75825673-1e18-44f8-bddf-4fbe0f9ed1c7`
  paper 帳號，2330 買進 1 股 @2415）：HTTP 422，`quoteGate.selectedSource="manual"`、
  `readiness="degraded"`、`paper.safe=false`、`primaryReason="fallback:higher_priority_unavailable"`。
  riskCheck 稽核列 id=`d53838fc-d648-4c6f-95a8-8c4e49f5570b`（僅風控稽核列，未落單，無需清理）。
- **根因非本輪任務範圍能修（`market-data.ts`/`risk-engine.ts` 為禁區檔）**：`GET /api/v1/kgi/status`
  確認 `gateway_quote_auth.errorCode="KGI_QUOTE_AUTH_UNAVAILABLE"`（KGI SIM 帳號未取得報價訂閱授權，
  沿用 6/2 舊病，見 memory `memory_kgi_quote_auth_unavailable_20260602.md`）+ TradingView webhook
  未活躍（priority 3 = 0）+ paper 自身報價源掛零（priority 2 = 0），四層 fallback 全數落到唯一剩下的
  `manual`（priority 1，靜態/非即時），報價閘門判定為 `synthetic_source`/`non_live_source` 而擋單。
- **系統性驗證**（非僅 2330 個案）：`GET /api/v1/market-data/decision-summary?symbols=` 10 檔主要股
  （2330/2317/2454/2603/2412/1101/2882/2881/3008/6505）→ `summary.paper.safe=0/10`、
  `summary.execution.safe=0/10`，**10/10 全部卡在同一個 `manual` fallback**，證實這是全通道系統性缺口，
  不是 2330 或零股單特有。
- 證據：`bruce_paper_1share_before_submit_desktop-chromium.png` /
  `bruce_paper_1share_after_submit_desktop-chromium.png`
- **清理**：無需清理——quoteGate 擋在 `recordUnifiedOrder()`（D3 pending-first 落庫）之前即返回，
  `GET /api/v1/trading/orders?accountId=75825673-...` 與 `GET /api/v1/uta/orders` 皆確認為空，
  prod 資料庫無任何測試單殘留。

### 6.3 kgi channel 現況 — **PASS（訊息形狀符合誠實記錄要求），但需澄清一個框架誤解**

- `GET /api/v1/uta/accounts` 確認 KGI SIM 帳號（id=`5790f6a1-644e-41b0-a7fb-bce7e3a23ec1`）
  `"gatewayStatus":"unpaired"`，broker strip 徽章實際渲染為「凱基 KGI未配對」（UI 截圖確認），與 7/9
  查詢結果一致，誠實反映現況。
- **重要澄清（讀原始碼＋API 覆核後確認，避免誤判）**：這個 `gatewayStatus=unpaired` 是 UTA Phase 2
  「客戶自跑 gateway 配對」機制的欄位（未來多券商 Option A 用），**目前 KGI SIM 沿用的是共用 EC2
  gateway，不走這條配對路徑**——讀 `apps/api/src/broker/trading-service.ts` 的 `submitOrder()` 確認
  送單流程完全不檢查 `broker_gateway_pairings`／`gatewayStatus`，KGI 分支只做
  `assertKgiSimChannel()`（環境/委託形狀檢查）。也就是說：**「未配對」徽章不是 KGI 送單被擋的真正原因**。
- 直接對 API 覆核（KGI accountId，同樣 2330 買進 1 股 @2415）：HTTP 422，quoteGate 結構與 §6.2 完全
  相同（`mode="execution"`、同一組 reasons、同一個 `selectedSource="manual"`）。riskCheck 稽核列
  id=`3d44722f-44b3-41e8-9f03-b51830e65771`（僅稽核列，無需清理）。
- 對照 `apps/web/lib/final-v031-live.ts` 的 `unifiedBlockedMessage()`：quoteGate.blocked 時回傳
  「報價檢查未通過，暫不能送出委託」——與 paper channel **完全同一句 Chinese 文案**，因為兩個通道共用
  同一個 `submitOrder()` 風控/報價閘門，KGI 分支的專屬檢查（`assertKgiSimChannel`）根本還沒機會執行
  就先被報價閘門攔下。
- UI 端到端點擊 3 次嘗試因 `refreshClientLive()` 週期性重繪與 Playwright 點擊時序競態，捕捉到 3 種
  不同瞬間快照（`需要 Owner 登入才能預覽/送出紙上單`──實為 `capitalReady` 暫時 false 的誤導文案、
  `KGI 模擬單 送單中...`、`2330 買進 1 股 @ 2415.00` 尚未送出前態），**皆非裸錯誤字串**，但因為
  DOM 重繪競態不夠穩定，不作為本項唯一證據——以上 API 層 + 原始碼交叉確認為準。
- 結論：KGI channel 現在「送不出去」的真正原因與 paper channel 相同（報價源退化），不是因為
  「未配對」。「未配對」徽章本身正確反映一個未來功能的現況，但不應被誤讀為本次送單失敗的因果。
- 證據：`bruce_kgi_channel_before_submit_desktop-chromium.png` /
  `bruce_kgi_channel_after_submit_desktop-chromium.png`
- F-AUTO 的 EC2 gateway 排程窗（另一條線）本輪未觸碰，符合任務指示。

## 最終 Verdict（7/10 盤中補驗後更新）

**手機版 M1-M5 可對楊董宣告「徹底完工，非零缺口清單已清空」**：981-1000px 死帶（唯一殘留的手機/響應式
缺口）經 #1198 修復並於本輪盤中對 prod 重掃 6/6 PASS，M1-M5 五輪處理的所有手機化痛點（390px 溢出 /
觸控目標 / 公司頁財報表格 / portfolio iframe 點擊被攔截 / 981-1000px 窄帶收合）皆已 prod 實測驗證修復，
**無殘留手機相關缺口**。

**但本輪盤中補驗意外發現一個與手機無關的系統性 P1**：paper 與 kgi 兩個下單通道現在都會被同一個
報價閘門擋下（10/10 主要股票報價全數退化到 `manual` 非即時來源），這不是 #1198 造成、不是盤中/盤後
時段問題、也不是委託大小問題——是報價供應鏈（KGI 報價訂閱授權 + TradingView webhook + paper 自身
報價源）三線同時掛零的既有缺口，7/10 盤中被本輪驗證首次直接證實會擋下**任何**送單嘗試。**這是交易台
核心功能缺口，建議另立 P1 由 Jason（market-data lane）處理**，不屬於本次手機驗收範圍，也不應因此
推翻「手機版徹底完工」的結論——手機化 UI 本身沒有問題，是它背後呼叫的下單能力現在系統性地打不通。
