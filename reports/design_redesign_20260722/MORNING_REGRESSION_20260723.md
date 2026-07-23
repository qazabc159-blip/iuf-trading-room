# 盤中回歸驗證批 — 2026-07-23 09:2x-09:3x TST

**Verifier**: Bruce（verifier-release-bruce）
**Prod 版本**：`GET /health` → `buildCommit=84e015a2843ce5fc72bc59bca75aa81fa8f566cd`
（= `git log origin/main` HEAD，含 #1343 news url passthrough / #1342 market-intel v1 redesign /
#1341 AI report display gate / #1339 seed / #1338 institutional enum fix；`git fetch` 後
`origin/main` 逐 commit 核對一致）。
**方法**：全新 owner session（`POST /auth/login` 現場登入，非重用既存 `storageState.json`），
`request.newContext` + `chromium` 混合驗證（API 直打 + 真瀏覽器 DOM/console 檢查）。
**未碰**：KGI gateway 任何端點（Jason 診斷中）／任何產品代碼（僅新增本報告 + 2 張截圖，
臨時驗證腳本已於驗證後從 repo 刪除，未 commit）。

---

## 結論摘要（10 行內）

1. 市場情報三大法人 9 格：仍 `state=unavailable, reason=finmind_returned_empty` — **BLOCKED_STRUCTURAL**（非回歸，見下）。
2. 新聞「看原文」：**PASS** — 10/10 則真實外部連結 `target=_blank`，API JSON 與頁面 DOM 逐條比對一致。
3. 首頁 hero band 指數盤中真值：**PASS** — 3 次全新 session 量測，真指數 44,898.17 於 1.7-3.9s 內出現，未被熱力圖拖住。
4. `/overview` 端點盤中 latency：**PASS** — 3 次 246ms / 1493ms / 1513ms，與既有 warm 基準一致，無回歸。
5. AI 分析報告顯示層（#1341）：**SKIP（誠實記錄，非阻擋，但意外發現見下）**。
6. 全站零 console/pageerror 抽查（首頁/市場情報/公司頁 2330）：**PASS** — 3 頁皆 0 console error / 0 pageerror。
7. **意外發現（重要）**：抽查近 100 筆 AI 分析歷史 run（7/11-7/23），**100/100 全部 synthesis 失敗**（`報告生成失敗（LLM 配額不足）`），無一筆有真報告內容可驗證渲染。
8. 是否可 deploy：本輪為驗證非新改動，不涉及 deploy 判斷。
9. 是否可宣告收口：#1335/#1337/#1343/看原文 三項可收口；三大法人＋AI 報告顯示層兩項因上游資料/LLM 因素無法在盤中或本輪完整驗證，建議轉列「已知限制」而非回歸阻擋。

---

## 詳細證據

### 1. 市場情報三大法人 9 格 — BLOCKED_STRUCTURAL（非回歸）

`curl` 直打（owner session）：
```
GET /api/v1/market/institutional-summary/finmind
→ {"asOf":null,"totalNet":null,"institutions":[],"topNetBuy":[],"topNetSell":[],
   "source":"finmind","staleAfterSec":60,"state":"unavailable","reason":"finmind_returned_empty"}
GET /api/v1/market/leaders/finmind → 同款 reason=finmind_returned_empty
```

**根因鑑識（讀 `apps/api/src/data-sources/finmind-aggregate-client.ts:506-563`）**：
`getFinMindInstitutionalSummary(date?)` 的 `date` 參數預設 `d = date ?? todayTaipei()`——**永遠查「今天」**，
無「查不到今天就退回最近一個已發布交易日」的 fallback（同檔案註解明寫「no TWSE fallback for
institutional」）。三大法人買賣超資料 FinMind 慣例於當日收盤後（約下午）才發布，故**盤中（今天
7/23 尚未收盤）查今天的三大法人資料本來就會是空的**——這不是「跨午夜空窗」會隨時間自動恢復的暫態，
而是這支端點的既有設計限制：只要是「今天」還沒收盤，9 格就會是 `--`，直到今天收盤後 FinMind 產生
當日資料。昨晚 22:5x（#1338 驗證時）能看到真值，是因為那時查的「今天」（7/22）已經收盤且 FinMind
已發布。

**視覺確認**（見 `market_intel_1440.png`）：三大法人 Panel 誠實顯示空進度條 + `--`，非假造 0 或
崩潰，符合產品鐵律「缺資料顯 EMPTY/STALE 真原因」。

**判定**：非 #1338/#1342 回歸，是結構性限制。若要盤中顯示「昨日」三大法人資料需另開票加
fallback（非本輪任務範圍，僅記錄轉交 Jason/Elva 判斷是否要做）。

### 2. 新聞「看原文」— PASS

`curl` 直打 `GET /api/v1/market-intel/news-top10`（owner session；注意正確路徑是
`/api/v1/market-intel/news-top10` 非 `/api/v1/market/news-top10`——後者 404，是我一開始猜錯路徑，
非產品問題）：
- `as_of=2026-07-23T00:58:50.257Z`（08:58:50 TST），`next_refresh_at=2026-07-23T01:58:00.000Z`
  （09:58 TST）— 目前在快取視窗內
- 10/10 items 皆有真實 `url` 欄位（非 undefined）

瀏覽器 DOM 交叉驗證（`/market-intel` 頁面）：10 個「看原文 →」連結，逐一 `href` 對比 API
`items[].url` 完全一致，`target="_blank"` 皆存在。範例：
`https://www.chinatimes.com/newspapers/20260722000353-260206`、
`https://stock.ltn.com.tw/article/l8c3rkaa6djt` 等。

**判定**：#1343 修復（FinMind wire `link`→`url` 型別修正）已生效，PASS。

### 3+4. #1335/#1337 盤中活態回歸 — PASS

**首頁 hero band 真指數出現時間**（3 次全新 session，非同一 context 重複載入）：
```
RUN 1: .idxanchor .giant 於 3890ms 出現，文字 "44,898.17" | 熱力圖選擇器 4116ms
RUN 2: .idxanchor .giant 於 3164ms 出現，文字 "44,898.17" | 熱力圖選擇器 4007ms
RUN 3: .idxanchor .giant 於 1735ms 出現，文字 "44,898.17" | 熱力圖選擇器 3587ms
```
指數與熱力圖選擇器出現時間差距僅 0.2-2.2s（同一 Suspense boundary 共用 `Promise.all` 的
`cachedMarket()`/`cachedRealtimeMarket()`——現行 `apps/web/app/page.tsx` 原始碼確認兩者本就在
同一個 `HeroBandSection` 內，非拆開的獨立 Suspense；決定盤中活態的是底層資料抓取速度，
非 Suspense 拆分本身），全部在 5s 內完成，未見回歸。

**`/overview` 端點盤中 latency**（owner session，連打 3 次）：
```
run 1: 1493ms status=200
run 2: 246ms  status=200
run 3: 1513ms status=200
```
與既有 memory 記錄的「warm 1.3s」基準一致，無劣化。

（附註：第一版測量誤用寬鬆 regex 導致量到 13164ms 的假訊號，是我的測量方法問題非產品問題，
已改用精準 selector `.idxanchor .giant` 重測，上列數字為修正後結果。）

### 5. AI 報告顯示層（#1341）— SKIP + 意外發現

依指示不觸發新生成（花錢），改用唯讀端點確認是否已有存檔報告：
- `GET /api/v1/admin/brain/react/company-report/:ticker` 對 2330/2317/2454/2382/3661/2412
  六檔皆 `report_md=null`
- 改抓 `GET /api/v1/admin/brain/react/decisions?limit=100`（近 100 筆歷史 run，7/11-7/23）逐筆
  `GET .../decisions/:run_id` 檢視內容

**意外發現（非本輪任務範圍但必須誠實記錄）**：**100/100 筆全部** `report_md` 恆為同一句 32 字
佔位訊息「分析完成。共執行 4 步推理。報告生成失敗（LLM 配額不足）。」——包含最新一筆
（`run_id=a991c414`，`createdAt=2026-07-23T01:29:50Z`，即約 4 分鐘前，ticker=3577）。讀
`apps/api/src/brain/react-loop.ts:836-889`：`finalStatus` 顯示 `"complete"`（非
`"budget_exceeded"`，代表沒撞到 app 層 cost cap），但最終 synthesis 呼叫 `callLlm()` 連續兩次
（含一次重試）皆回傳 `null`——即 LLM 呼叫本身在 API/帳務層失敗，非本頁報告本身的顯示邏輯問題。

**判定**：#1341 的顯示閘門本身無法驗證渲染真報告（因為過去至少 12 天沒有一筆真報告產出可供渲染），
這不是 #1341 的回歸，但代表 AI 公司報告這個功能對用戶而言目前形同虛設（永遠顯示失敗訊息，從未見過
真報告）。建議 Elva/Jason 對照 memory `reference_llm_outage_triage_playbook` 排查 OpenAI 帳務/
配額，這是比顯示層更上游、更值得優先處理的問題。

### 6. 全站零 console/pageerror 抽查 — PASS

| 頁面 | console error | pageerror |
|---|---|---|
| `/`（首頁） | 0 | 0 |
| `/market-intel` | 0 | 0 |
| `/companies/2330` | 0 | 0 |

---

## 產物路徑

- 本報告：`reports/design_redesign_20260722/MORNING_REGRESSION_20260723.md`
- 截圖：`reports/design_redesign_20260722/morning_regression_20260723/home_1440.png`、
  `reports/design_redesign_20260722/morning_regression_20260723/market_intel_1440.png`
- 臨時驗證腳本（`_bruce_morning_regression_20260723.mjs`、`_bruce_hero_timing_20260723.mjs`）
  用完即從 `packages/qa-playwright/` 刪除，未 commit。

## 是否可宣告收口

- **#1343（新聞看原文）**：可收口，PASS 有證據。
- **#1335/#1337（盤中活態）**：可收口，PASS 有證據，無回歸。
- **三大法人 9 格**：不建議標記為「阻擋」——這是既有設計對「今天」資料的結構性限制，非可在本輪
  修復的 bug；若要盤中顯示「昨日」法人資料需另開票（fallback 邏輯），交 Jason 評估要不要做。
- **AI 報告顯示層（#1341 + Pete 🟡）**：仍 SKIP，非本輪可收口項目——根本原因在 LLM 呼叫本身
  （疑似帳務/配額），優先序建議調高，交 Elva/Jason。
