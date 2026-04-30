# Bruce Work Order — 4-State UI Harness (spec-level v1)

Issued: 2026-05-01 01:42 Taipei
Owner: Bruce
Audience: Codex (frontend producer), Elva (lane), Pete (PR review)
Coordination doc: `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

## Context

Codex 從今晚起接管 frontend real-data conversion。Production UI hard rule：每個 visible panel 必須是 LIVE / EMPTY / BLOCKED / HIDDEN，禁 silent mock。

你今晚的工作是**立刻**做 spec-level 驗證 harness（不等 Codex 第一波 patch 落地），讓 Codex 每次提交都能跑這個 harness 自驗。

第二版 selector-level 驗證（DOM / data-testid）等 Codex 第一波 patch 落地後再做。

## Output Location

寫到：`evidence/w7_paper_sprint/bruce_4state_harness_v1_2026-05-01.md`

完成後在 board `Backend Ready` 區附 link + 一行 summary。

## v1 Spec-Level Harness 必驗 7 條

### 1. Panel 4-State 歸類

每個 visible panel 必須能歸類為其中一種：

- **LIVE** — 真資料，必須帶 `source` field（"finmind"/"twse"/"paper_ledger"/"kgi_readonly"/"db"）+ `updatedAt` field（ISO8601 with timezone）
- **EMPTY** — 真查詢回 0 row，UI 必須顯示「empty reason」（e.g. "no announcements in last 30 days"）
- **BLOCKED** — feature 故意不可用，UI 必須顯示 `blocker` text + `owner` text
- **HIDDEN** — 整個 panel 不 render（無 DOM 出現）

### 2. LIVE State 必要欄位

LIVE panel 必須在 visible UI 上顯示（或 dev-tools data attr）:
- source（哪個資料源）
- updatedAt（最後更新時間，人類可讀）

不顯示 source/updatedAt 但聲稱 LIVE → FAIL

### 3. BLOCKED State 必要欄位

BLOCKED panel 必須顯示：
- blocker（為什麼不可用，e.g. "KGI quote feed not wired"）
- owner（誰能解，e.g. "Operator + Jason"）

只 disabled 沒原因 → FAIL

### 4. EMPTY State 必要欄位

EMPTY panel 必須顯示：
- 真實查詢成功的證據（e.g. "Query OK, 0 results"）
- 0 row 的 reason（e.g. "No paper orders today" / "No announcements in lookback window"）

空 div / 純 "—" / "No data" 沒 reason → FAIL

### 5. 禁止 Mock Label 消失但資料假

若 panel 之前是 mock，現在 mock label 拿掉但底層資料仍是 hardcoded constant → FAIL

驗法：
- grep `mock` / `fake` / `placeholder` / `lorem` / `sample` 在 `apps/web/**`
- 對每個結果判斷：是否 production path 會 render

### 6. 禁止 Disabled Button 沒原因

任何 `<button disabled>` 在 visible UI：
- 必須有同位的 tooltip / label 說明為什麼 disabled
- e.g. "Disabled — paper risk gate not ready" / "Disabled — KGI live submit blocked"

無原因的 disabled → FAIL

### 7. 禁止 API Fail 變 Fake Success

`apps/web/lib/**` 任何 fetch wrapper 必須驗：
- API 4xx/5xx 不准 fallback 到 mock
- `radar-api.ts`、`radar-uncovered.ts` 已知有 fake fallback 風險（per board P5）— 必須點名驗
- production NODE_ENV 下不准 silent fallback

驗法：
- grep `catch` / `fallback` / `mock` 在 fetch wrappers
- 對每個 catch 判斷：是 throw / return BLOCKED / return EMPTY / 還是 fake success？

## 交付節奏

- **First spec draft**: cycle 1 = 2026-05-01 02:00 Taipei（18min 內）— 7 條規則寫成 checklist + 對應驗法（grep pattern / DOM 檢查 / fetch wrapper 檢查）
- **Codex 第一波 patch 落地後**: 補 selector-level 驗證（看實際 DOM / fetch behavior）
- **每輪 cycle**: Elva 會在 board 看你進度

## 巡查節奏

每 30min 跑一次 grep harness（你決定哪些 pattern 跑），把 FAIL 寫到 board `Blockers`。

不需要跑全部 production smoke — 那個你已經有 daily smoke harness，繼續跑那個。今天要做的是**新增** 4-state UI 驗證。

## Stop-lines（你不准動）

- 不要動 frontend code（你是 verify lane，不是 producer）
- 不要刪除 panel — 看到不對只寫 Blocker，由 Codex 改
- 不要動 broker / risk / migration（不是你 lane）
- redaction 不變嚴 — KGI account/person_id/broker_id raw 看到立刻寫 P0 blocker

## 派工人 ACK

Bruce，照辦。完成 first draft 在 board 寫一行：
`Bruce 4-state harness v1 DONE @ <time> → <evidence file path>`

—— Elva
