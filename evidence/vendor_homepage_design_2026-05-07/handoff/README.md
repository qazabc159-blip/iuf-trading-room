# IUF · 交易戰情台 — 後端對接交付包

> 給 Codex / 後端工程師的完整對接指南。前端是純 React + Babel(瀏覽器內編譯)的 hi-fi prototype,所有畫面都已經接好,只差把模擬資料 (`data.js`) 換成真實 API。

---

## 1. 這份交付包是什麼

一個**已完成的 1920×1280 戰情台 dashboard 前端**,設計核心原則是:

> **「先確認資料能不能用,再進交易工作流。」**

- 不假裝有資料 — 過期、空、被阻擋的資料來源**全部如實標示**
- 不出買賣建議 — 策略候選顯示信心分數,但不出現「買進 / 賣出 / 目標價」
- 永不下真實單 — KGI 通道仍鎖在 `libCGCrypt.so` 之外,系統設計上 `paper-only`

整份 dashboard 由 **11 個 panel** 組成,所有資料都來自 `frontend/data.js` 裡的 `window.IUF_*` 全域變數。後端要做的事情就是 — **把這些全域變數的內容替換成真實 API 回應**。

---

## 2. 檔案結構

```
handoff/
├── README.md                     ← 本檔(從這裡開始讀)
├── BACKEND_SPEC.md               ← 後端必讀:每個 API 的 contract / 更新頻率 / 錯誤處理
├── DATA_CONTRACTS.md             ← TypeScript 型別定義(可直接 copy 進 backend repo)
├── COMPONENTS.md                 ← 11 個 panel 的元件清單與資料來源對應表
├── STATUS_RULES.md               ← 狀態判定邏輯(LIVE / STALE / EMPTY / BLOCKED 怎麼算)
├── OPENAPI.yaml                  ← OpenAPI 3.1 spec(可餵給 codegen)
└── frontend/
    ├── index.html                ← 進入點
    ├── tokens.css                ← 設計 tokens(色彩 / 字型 / 動畫)
    ├── data.js                   ← ⭐ 模擬資料(後端要替換的目標)
    ├── components.jsx            ← 共用元件(StatusChip / Sparkline / HeartbeatClock 等)
    └── direction-a-v3.jsx        ← 主畫面 component(11 個 panel 全在裡面)
```

---

## 3. 30 秒快速上手

```bash
# 直接開啟看畫面
cd handoff/frontend
python3 -m http.server 8000
# 瀏覽 http://localhost:8000
```

> 必須要 HTTP server,不能直接 `file://` 開啟 — Babel 透過 `<script src>` 載入 `.jsx` 會被 CORS 擋。

---

## 4. 後端對接策略(三條路擇一)

### Path A · 最小變動(推薦給 MVP)
保留現有前端,讓後端提供**一支聚合 API**,回傳完整 `IUF_DATA` 結構。前端把 `data.js` 換成 fetch:

```js
// data.js 改成:
const r = await fetch("/api/dashboard/snapshot");
Object.assign(window, await r.json());
```

後端只需做 1 支 endpoint:`GET /api/dashboard/snapshot` → 回傳所有 `IUF_*` 全域變數。

### Path B · 拆分 endpoint(推薦給正式環境)
按更新頻率拆分成多支 endpoint(見 `BACKEND_SPEC.md`)。前端改成多支 `fetch` 並套用各自的 polling interval:
- 報價(30s) / 資料源狀態(60s) / FinMind 健康(60s) / OpenAlice queue(15s) / Paper E2E(on-action) / 漲跌家數(5min)

### Path C · WebSocket(未來)
保留 Path B 的 endpoint 作為初始 snapshot,即時資料(報價 / queue / heartbeat)改 WebSocket push。前端只需改幾行 hook;當前所有元件已經設計成 idempotent re-render。

---

## 5. 資料來源 inventory(後端要負責的 8 個來源)

| key | 名稱 | 來源系統 | 後端動作 |
|---|---|---|---|
| `finmind` | FinMind 台股日線 | FinMind API + Sponsor 999 token | proxy + quota 統計 |
| `kline` | K 線資料 | FinMind `TaiwanStockPriceAdj` | 抓取 + 還原計算 |
| `company` | 公司基本 / 財報 | FinMind `TaiwanStockInfo` 等 | ETL 寫 DB |
| `openalice` | 每日簡報引擎 | 內部 OpenAlice runner / dispatcher | 健康檢查 + queue 統計 |
| `topic` | 資料庫主題 | 內部主題回灌批次 | 跑批次 + 報 `last_update_at` |
| `strategy` | 策略候選池 | 內部策略 service | 不要出買賣建議 |
| `signal` | 訊號證據 | 內部測試訊號 ETL | 跑批次 + 報 `last_update_at` |
| `news` | 重大訊息 | 公開資訊觀測站 (MOPS) | **尚未接入,不可造假** |

---

## 6. 設計鐵則(請務必遵守)

1. **過期就標過期** — 只要 `now - last_update_at > 1 day`,該來源回 `status: "stale"` + `days: N`,不要試圖用昨日資料填今天
2. **空就標空** — 沒接入 / 抓失敗 / 認證失效 都應該回 `status: "empty"`,前端會顯示「尚未可用」並說明原因
3. **不顯示 token 值** — FinMind token 只回 `tokenPresent: true|false`,**永遠不回 token 字串**
4. **Source trail 不完整就不發布** — OpenAlice 簡報如果有任何上游 `stale` / `empty`,`publishedToday` 必須維持 0,並在 `sourceTrail.missing` 列出原因
5. **永遠不可以連真實券商** — `paperE2E` 流程到第 6 段(audit log)為止,沒有第 7 段。`portfolio.readiness` 永遠是 `"preview-only"`
6. **正式下單 BLOCKED** — `meta.formalOrder.state` 永遠回 `"blocked"`,直到 KGI 通道解鎖前不要改

---

## 7. 接下來請依序閱讀

1. **`BACKEND_SPEC.md`** — 每支 API 的 contract、polling 頻率、錯誤格式、status 邏輯
2. **`DATA_CONTRACTS.md`** — TypeScript 型別,可直接複製進 backend repo 當 single source of truth
3. **`COMPONENTS.md`** — 11 個 panel 用了哪些資料欄位,改資料時要看誰會受影響
4. **`STATUS_RULES.md`** — 狀態判定邏輯(這份很重要,不要自行詮釋)
5. **`OPENAPI.yaml`** — 可丟進 swagger / openapi-generator 產 client SDK

---

## 8. 設計細節:每個面板都有故事

每個 panel 都對應到「**先確認資料能不能用**」的某個面向:

- **頂部跑馬燈** — 即使是市場資料,EMPTY 時前置「市場資料 EMPTY · 以下為示意」徽章
- **戰情 Hero** — 5 段式狀態列(OBSERVE / OPERATOR / SESSION / NEXT ACTION / BLOCKED)+ TWII 走勢 + 漲跌家數 + 4 KPI
- **資料源狀態** — 8 來源的 LIVE / STALE / EMPTY / REVIEW 一覽,每行一條 sparkline
- **資料新鮮度時間軸** — 對數刻度,5 LIVE / 2 STALE / 1 EMPTY 視覺化
- **公司池 Heatmap** — Treemap 比例(台積電獨佔左半);市場資料 EMPTY 時整塊打標
- **FinMind 資料健康** — Token presence、Quota 進度、最近 5 筆 request 軌跡
- **OpenAlice 簡報** — Runner / Dispatcher 心跳、Queue 數、Source trail 缺口、5 步 pipeline
- **Paper E2E** — 6 段紙上交易流程,每段都有 count
- **策略候選** — 4 檔台股,顯示信心分數但**閘門全 BLOCKED**
- **今日交易工作流** — 5 個動線(查公司 / 紙上交易 / Portfolio / 簡報 / 監控)
- **待處理** — 4 件尚未可用(重大訊息 / 訊號證據 / 量化研究 / 正式下單)

---

## 9. 有問題?

設計層面的決定都有理由 — 如果某個欄位、某個狀態看起來奇怪,**先讀 STATUS_RULES.md**,那裡會解釋為什麼這樣設計。如果看完還有疑問再回來問。

— 設計交付於 2026/05/06
