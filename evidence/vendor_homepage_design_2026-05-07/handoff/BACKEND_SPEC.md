# BACKEND_SPEC — 後端 API 對接規格

> 此文件定義所有需要後端實作的 API。前端會 consume 這些 endpoint 並把結果塞進 `window.IUF_*`。

---

## 0. 通用約定

### Base URL
```
/api/v1
```

### 通用 Response 包裝(可選但建議)
```json
{
  "data": { ... },
  "meta": {
    "fetchedAt": "2026-05-06T20:51:45+08:00",
    "ttl": 30
  },
  "errors": []
}
```

### 通用錯誤格式
```json
{
  "data": null,
  "errors": [
    { "code": "UPSTREAM_TIMEOUT", "message": "FinMind 60s 內未回應", "field": "finmind" }
  ]
}
```

### 時間格式
- 所有 timestamp 一律 **ISO 8601 + 台北時區 (+08:00)**
- 顯示用的短字串(`"05/06 20:51"`)由前端 format,後端只回 ISO 8601

### 認證
- Cookie session 或 Bearer JWT(後端決定),所有 endpoint 都需登入
- 操作員身份由 session 帶入 → 反映到 `meta.operator`

### CORS
- Dev:允許 `http://localhost:8000`
- Prod:同 origin

---

## 1. Endpoint 清單

| Method | Path | 用途 | Polling | 對應 panel |
|---|---|---|---|---|
| GET | `/api/v1/dashboard/snapshot` | 一次取得整個 dashboard | 60s | (全部,for Path A) |
| GET | `/api/v1/meta` | 操作員 / 模式 / 現在時間 | on-load | 頂部命令列 |
| GET | `/api/v1/sources` | 8 個資料來源狀態 | 60s | 資料源狀態 / 新鮮度時間軸 |
| GET | `/api/v1/sources/{key}` | 單一來源 detail(drawer 用) | on-click | Detail drawer |
| GET | `/api/v1/quotes` | 市場報價(指數 + 三大法人 + 個股) | 30s | 跑馬燈 / Hero TWII |
| GET | `/api/v1/breadth` | 漲跌家數 | 5min | Hero |
| GET | `/api/v1/heatmap` | 公司池 Treemap | 5min | 公司池 Heatmap |
| GET | `/api/v1/agenda` | 今日節奏 | 5min | 任務節奏橫條 |
| GET | `/api/v1/finmind/health` | FinMind quota / 請求軌跡 | 30s | FinMind panel |
| GET | `/api/v1/openalice/status` | OpenAlice runner / queue / pipeline | 15s | OpenAlice panel |
| GET | `/api/v1/paper/e2e` | 6 段紙上交易流程 count | 15s | Paper E2E |
| GET | `/api/v1/portfolio/preview` | 預覽部位 | 30s | Paper E2E 底部 |
| GET | `/api/v1/strategy/ideas` | 策略候選 | 5min | 策略候選 |
| GET | `/api/v1/workflow/today` | 5 個動線狀態 | 60s | 今日交易工作流 |
| GET | `/api/v1/blocked` | 4 件尚未可用 | 5min | 待處理 |

---

## 2. 詳細 Spec

### 2.1 GET /api/v1/dashboard/snapshot
聚合 endpoint。MVP 用,內部其實就是平行呼叫上面所有 sub-endpoint 後組裝。

**Response**(完整結構見 `DATA_CONTRACTS.md` 的 `DashboardSnapshot` 型別):
```json
{
  "meta": { "operator": "IUF-01", "mode": "模擬模式 / 風控守門", "market": "盤面 / 真實資料", "nowText": "2026/05/06 20:51:45 台北", "formalOrder": { "state": "blocked", "reason": "KGI 正式下單仍鎖在 libCGCrypt.so 之外" } },
  "sources": [ /* 8 個 SourceStatus */ ],
  "quotes": { /* IUF_QUOTES */ },
  "breadth": { "up": 412, "flat": 87, "down": 1148, "total": 1647 },
  "heatmap": [ /* HeatmapTile[] */ ],
  "agenda": [ /* AgendaItem[] */ ],
  "finmind": { /* FinmindHealth */ },
  "openalice": { /* OpenAliceStatus */ },
  "paperE2E": [ /* PaperStep[] (6 entries) */ ],
  "portfolio": { /* PortfolioPreview */ },
  "strategyIdeas": [ /* StrategyIdea[] */ ],
  "workflow": [ /* WorkflowItem[] */ ],
  "blocked": [ /* BlockedItem[] */ ]
}
```

---

### 2.2 GET /api/v1/sources
8 來源狀態列表。**這是整個系統的核心 endpoint**,因為「先確認資料能不能用」就靠它。

**Response:**
```json
[
  {
    "key": "finmind",
    "name": "FinMind",
    "short": "FinMind",
    "desc": "台股日線 / 基本面",
    "status": "live",
    "lastUpdateAt": "2026-05-06T20:51:00+08:00",
    "updated": "05/06 20:51",
    "note": "今日資料",
    "stalenessMinutes": 1,
    "detail": "Sponsor 999 token 存在;6,000/小時 quota 中已使用 346 次。",
    "cta": null,
    "days": null
  },
  {
    "key": "topic",
    "name": "主題資料",
    "status": "stale",
    "lastUpdateAt": "2026-04-23T02:34:00+08:00",
    "stalenessMinutes": 18720,
    "days": 13,
    "detail": "資料庫主題上一次回灌為 04/23 02:34,已過期 13 天。下一步:重跑主題回灌批次。",
    "cta": "查看主題板 ›"
  },
  {
    "key": "news",
    "name": "重大訊息",
    "status": "empty",
    "lastUpdateAt": null,
    "stalenessMinutes": null,
    "detail": "公開資訊觀測 (MOPS) 來源尚未接入,目前無法顯示重大訊息;首頁不出現假資料。"
  }
]
```

**Status 規則**(詳見 `STATUS_RULES.md`):
- `live` — `lastUpdateAt` 在 24h 內且資料筆數 > 0
- `stale` — `lastUpdateAt` 超過 24h
- `empty` — 從未抓到資料 / 來源未接入
- `review` — OpenAlice 專用:Runner healthy 但今日簡報未發布
- `blocked` — 後端阻擋(認證失效、金鑰過期等)

**8 個 key 是固定的**,前端寫死順序:
```
finmind / kline / company / openalice / topic / strategy / signal / news
```

---

### 2.3 GET /api/v1/sources/{key}
Drawer 點某一行時呼叫。Response 是 SourceStatus 的延伸版,多帶 `events[]`(該來源最近的 audit log)。

```json
{
  "key": "openalice",
  "name": "OpenAlice",
  "status": "review",
  "events": [
    { "at": "2026-05-06T20:51:00+08:00", "level": "info", "message": "Runner heartbeat OK" },
    { "at": "2026-05-06T20:48:12+08:00", "level": "warn", "message": "Source trail 缺主題資料" }
  ]
}
```

---

### 2.4 GET /api/v1/quotes
**重要:如果市場資料來源 status = empty,response 必須帶 `sourceState: "empty"`,前端會顯示「以下為示意」徽章**。

```json
{
  "sourceState": "empty",
  "sourceLabel": "市場資料 · 無資料 / 顯示為示意",
  "indices": [
    { "sym": "TWII", "name": "加權指數", "price": 22847.32, "chg": -132.45, "pct": -0.58 }
  ],
  "flows": [
    { "sym": "外資", "name": "外資買賣超", "price": -8842, "unit": "百萬" }
  ],
  "stocks": [
    { "sym": "2330", "name": "台積電", "price": 1085, "chg": -10, "pct": -0.91 }
  ],
  "intradayTwii": [22980, 22975, /* ... 60 點 */ 22847.32]
}
```

- `intradayTwii` — 60 點分時走勢,給 Hero 的 IntradayChart 用
- `stocks` — 18 檔個股,跑馬燈用
- 漲跌色：**紅漲綠跌(台股慣例)**,前端已寫對

---

### 2.5 GET /api/v1/finmind/health

```json
{
  "sponsor": "Sponsor 999",
  "tokenPresent": true,
  "quotaTotal": 6000,
  "quotaUsed": 346,
  "datasets": { "ok": 0, "downgraded": 4, "blocked": 0 },
  "recentRequest": { "name": "TaiwanStockPriceAdj", "at": "2026-05-06T20:51:00+08:00", "ok": true },
  "requests": [
    { "name": "TaiwanStockPriceAdj", "at": "2026-05-06T20:51:38+08:00", "ms": 412, "ok": true, "why": null },
    { "name": "TaiwanStockShareholding", "at": "2026-05-06T20:50:12+08:00", "ms": 1902, "ok": false, "why": "降級:rate limit / 60s 後重試" }
  ]
}
```

⚠️ **絕對不要**回 `tokenValue` 字串。`tokenPresent` 是 boolean。

---

### 2.6 GET /api/v1/openalice/status

```json
{
  "runner":     { "state": "healthy", "lastHeartbeat": "2026-05-06T20:51:00+08:00" },
  "dispatcher": { "state": "healthy", "lastScan":      "2026-05-06T20:51:00+08:00" },
  "queue": { "queued": 608, "running": 0, "review": 0 },
  "publishedToday": 0,
  "sourceTrail": {
    "complete": false,
    "missing": ["主題資料(過期 13 天)", "訊號證據(過期 15 天)"]
  },
  "aiReview": {
    "state": "review",
    "waiting": 0,
    "note": "尚無待審 — 因 source trail 不完整,今日簡報未進入 AI 審核"
  },
  "pipeline": [
    { "id": 1, "name": "資料拉取",   "state": "ok",   "note": "FinMind / 公司資料 已就緒" },
    { "id": 2, "name": "Source 拼接", "state": "warn", "note": "主題、訊號 過期,以「尚未可用」標示" },
    { "id": 3, "name": "草稿生成",   "state": "wait", "note": "等待 source trail 補齊" },
    { "id": 4, "name": "AI 審核",    "state": "wait", "note": "未啟動" },
    { "id": 5, "name": "已發布",     "state": "wait", "note": "今日 0 則" }
  ],
  "notice": "簡報屬於 source trail,不是投資建議"
}
```

**規則**:
- `sourceTrail.complete = false` 時,`publishedToday` **必須** = 0
- `pipeline` 5 段順序固定:資料拉取 → Source 拼接 → 草稿生成 → AI 審核 → 已發布
- pipeline state: `ok` / `warn` / `wait` / `idle`

---

### 2.7 GET /api/v1/paper/e2e

```json
[
  { "id": 1, "name": "Preview",       "desc": "委託預覽",     "state": "ok",   "count": 4,  "note": "4 筆預覽就緒" },
  { "id": 2, "name": "Risk Check",    "desc": "風控檢查",     "state": "ok",   "count": 4,  "note": "全部通過 / 0 阻擋" },
  { "id": 3, "name": "Order Draft",   "desc": "委託草稿",     "state": "ok",   "count": 2,  "note": "2 筆待提交" },
  { "id": 4, "name": "Paper Submit",  "desc": "紙上送出",     "state": "wait", "count": 0,  "note": "等待操作員確認" },
  { "id": 5, "name": "Simulated Fill","desc": "模擬成交",     "state": "idle", "count": 0,  "note": "—" },
  { "id": 6, "name": "Audit Log",     "desc": "稽核軌跡",     "state": "ok",   "count": 12, "note": "今日 12 筆" }
]
```

⚠️ **沒有第 7 段**。Paper E2E 結束就是 audit log,沒有「真實送出」。

---

### 2.8 GET /api/v1/portfolio/preview

```json
{
  "cash": 1000000,
  "positions": 0,
  "readiness": "preview-only",
  "note": "紙上預覽,不連真實券商"
}
```

⚠️ `readiness` 永遠是 `"preview-only"`。

---

### 2.9 GET /api/v1/strategy/ideas

```json
[
  { "sym": "3081.TW", "name": "聯亞", "stance": "中性", "confidence": 11.3, "gate": "blocked", "reason": "訊號證據過期" }
]
```

**規則**:
- `stance` 只能是 `"中性"` / `"偏多研究"` / `"偏空研究"` — **不可以**出現「買進」「賣出」「目標價」
- `gate` 只要訊號證據 stale/empty,全部 `"blocked"`
- `confidence` 0-100 的小數,只是研究用信心,**不是勝率不是預測**

---

### 2.10 GET /api/v1/workflow/today

```json
[
  { "id": "w1", "title": "查 2330 公司頁", "desc": "K 線、FinMind、紙上 preview 均已同頁", "cta": "進入公司頁", "state": "ok",   "href": "/company/2330" },
  { "id": "w4", "title": "每日簡報",       "desc": "等 OpenAlice source trail 補齊",       "cta": "查看 trail", "state": "wait", "href": "/openalice" }
]
```

`state`:`ok` / `wait`(只有兩種)。

---

### 2.11 GET /api/v1/blocked

```json
[
  { "name": "重大訊息",   "why": "尚未接入公開資訊觀測站",       "next": "等接入 + 排程", "icon": "news" },
  { "name": "正式下單",   "why": "KGI 通道仍鎖在 libCGCrypt.so", "next": "解鎖前永遠 BLOCKED", "icon": "lock" }
]
```

`icon`: `news` / `signal` / `lab` / `lock`

---

### 2.12 GET /api/v1/heatmap
公司池,treemap 用。**前端版面寫死前 23 檔**,後端可以多回但只有前 23 會顯示。

```json
[
  { "sym": "2330", "name": "台積電", "pct": -0.91, "mcap": 28140 }
]
```

- `mcap` — 市值(億 NT$)
- `pct` — 當日漲跌幅(%)
- 排序:**按市值降冪**

⚠️ 如果 quotes.sourceState = "empty",heatmap response 也應該帶 `sourceState: "empty"`(包成 `{ sourceState, tiles }`),前端會打標。

---

### 2.13 GET /api/v1/breadth

```json
{
  "up": 412,
  "flat": 87,
  "down": 1148,
  "total": 1647,
  "asOf": "2026-05-06T13:30:00+08:00"
}
```

收盤後固定不變;盤中每 5 分鐘更新。

---

### 2.14 GET /api/v1/agenda

```json
[
  { "time": "09:00", "label": "開盤",          "state": "done" },
  { "time": "20:51", "label": "現在",          "state": "now" },
  { "time": "23:30", "label": "次日計畫鎖定",  "state": "todo" }
]
```

`state`:`done` / `doing` / `now` / `todo`。每天首次呼叫時後端要 reset 整份 agenda。

---

### 2.15 GET /api/v1/meta

```json
{
  "operator": "IUF-01",
  "mode": "模擬模式 / 風控守門",
  "market": "盤面 / 真實資料",
  "nowText": "2026/05/06 20:51:45 台北",
  "formalOrder": {
    "state": "blocked",
    "reason": "KGI 正式下單仍鎖在 libCGCrypt.so 之外"
  }
}
```

---

## 3. Polling vs WebSocket

MVP 階段建議純 polling:

| Endpoint | 頻率 | 理由 |
|---|---|---|
| sources | 60s | 狀態變動慢 |
| quotes | 30s 盤中 / 5min 盤後 | 盤中即時感即可 |
| openalice/status | 15s | queue 變動快 |
| finmind/health | 30s | quota 累積感 |
| paper/e2e | 15s | 操作員會等 |
| 其餘 | 5min | 變動慢 |

未來改 WS 時:`sources / quotes / openalice/status` 三個改 push,其他保留 polling。

---

## 4. 錯誤處理 — 上游掛掉時怎麼辦

> ❗ 這是整個系統的設計核心:**寧可正確標示 EMPTY,也不要假裝有資料**。

| 情境 | 後端動作 |
|---|---|
| FinMind API 全掛 | `sources.finmind.status = "empty"` + `detail` 解釋原因 |
| FinMind quota 用完 | `sources.finmind.status = "blocked"` + `detail = "quota exhausted, retry at HH:MM"` |
| 部分資料集失敗 | `finmind.datasets.downgraded` 加 1,`requests` 加一筆 `ok: false, why: "..."` |
| OpenAlice runner crash | `openalice.runner.state = "error"`,**不要**用上次 cache 假裝 healthy |
| 主題回灌批次失敗 | `sources.topic.status` 維持 `stale` + `lastUpdateAt` 不更新 |

---

## 5. 安全

- ❌ 永遠不要回 FinMind token 字串到前端
- ❌ 永遠不要回 KGI 任何金鑰 / cert
- ❌ 永遠不要在 response 裡放真實券商 endpoint
- ✅ 操作員 ID(`IUF-01`)是 OK 的(已脫敏)

---

## 6. 部署檢查清單

- [ ] 所有 endpoint 回 200(空集合也是 200,不要 404)
- [ ] 所有 timestamp 是 ISO 8601 + `+08:00`
- [ ] Status 邏輯通過 `STATUS_RULES.md` 全部測項
- [ ] FinMind token 不在 response 裡(grep response body 不應出現 token)
- [ ] `paperE2E` 是 6 個元素,`pipeline` 是 5 個元素,`sources` 是 8 個元素 — 順序固定
- [ ] `formalOrder.state` 是 `"blocked"`
- [ ] `portfolio.readiness` 是 `"preview-only"`
