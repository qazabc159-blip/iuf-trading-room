# STATUS_RULES.md — 狀態判定邏輯

> 此文件是「先確認資料能不能用」原則的具體實作規則。**請後端嚴格遵守,不要自行詮釋**。

---

## 1. SourceState 判定流程(每個資料來源都要過這個流程)

```
給定一個 source 的最近抓取記錄 records[]:

if records.length === 0 || source 從未接入:
    return "empty"

if 認證失效 / 金鑰過期 / 後端拒絕:
    return "blocked"

if 最近抓取 throws / timeout 連續 N 次:
    return "error"

let lastUpdateAt = max(records.map(r => r.at))
let stalenessMin = (now - lastUpdateAt) / 60000

if stalenessMin > 1440 (24h):
    return "stale"

if source === "openalice" && 今日簡報未發布 && Runner healthy:
    return "review"

return "live"
```

---

## 2. 各來源具體規則

### finmind
- `live` — 過去 1 小時內有成功 request
- `stale` — 超過 24h 沒有成功 request
- `blocked` — quota exhausted 或 token invalid
- `empty` — 從未抓過

### kline / company
- 同 finmind 規則,以「最近成功寫入 DB 的時間」為準

### openalice
- `live` — 今日已發布且 source trail complete
- `review` — Runner+Dispatcher healthy,但今日簡報未發布
- `error` — Runner 或 Dispatcher 任一 unhealthy
- `empty` — 系統未啟動

### topic / signal
- `live` — 最近批次成功完成 < 24h 內
- `stale` — 最近批次成功 > 24h
- 算 `days = floor(stalenessMin / 1440)`,寫進 `note: "過期 N 天"`

### strategy
- `live` — 候選池有最近資料
- 但 `gate` 一律看 signal 是否 stale,signal stale → 全部 blocked

### news
- 永遠 `empty`,直到 MOPS 接入
- `lastUpdateAt: null`,`updated: "—"`

---

## 3. 衍生規則

### 3.1 OpenAlice 不可發布的條件
```
if openalice.sourceTrail.complete === false:
    publishedToday MUST = 0
    aiReview.state = "review"
    pipeline[2..4].state = "wait"
```

### 3.2 策略候選閘門
```
if sources.find(s => s.key === "signal").status !== "live":
    所有 strategyIdeas[i].gate = "blocked"
    strategyIdeas[i].reason = "訊號證據過期"
```

### 3.3 Quotes 標 EMPTY
```
if 市場資料來源 status !== "live":
    quotes.sourceState = "empty"
    quotes.sourceLabel = "市場資料 · 無資料 / 顯示為示意"
    heatmap.sourceState = "empty"
```

### 3.4 Hero 4 KPI 計算
```
可用來源 = sources.filter(s => s.status === "live").length
需處理 = sources.filter(s => ["stale", "empty", "blocked", "error"].includes(s.status)).length
交易能力 = "Paper" (永遠)
正式下單 = meta.formalOrder.state === "blocked" ? "封鎖" : "—"
```

---

## 4. 永久不變的規則(這些是 system invariants)

| 不變式 | 強度 |
|---|---|
| `meta.formalOrder.state === "blocked"` | 直到 KGI 解鎖前永遠 true |
| `portfolio.readiness === "preview-only"` | 永遠 true |
| `paperE2E.length === 6` | 永遠 |
| `pipeline.length === 5` | 永遠 |
| `sources.length === 8` | 永遠,順序固定 |
| `tokenPresent` 不可洩漏 token 字串 | 永遠 |
| `strategyIdeas[i].stance ∉ {買進, 賣出}` | 永遠 |

---

## 5. 測試案例(後端必過)

### Case A:全綠
所有 8 來源 live → `可用 5+, 需處理 0`(理論上;但通常會有 news/signal 卡住)

### Case B:今日狀態(對應現在 mock 資料)
- finmind/kline/company/strategy live
- topic stale 13d, signal stale 15d
- openalice review
- news empty
- → `可用 = 4, 需處理 = 4` (注意 review 也算需處理視覺上)

### Case C:FinMind 全掛
- finmind/kline/company → empty/blocked
- openalice → review(Runner 還在,但 source trail 缺更多)
- → 整個 dashboard 應該幾乎都黃 / 紅,但不應該 crash

### Case D:測試「假裝有資料」反向案例
- 後端**不可以**用昨日 cache 在今日回 status=live
- 後端**不可以**在 quotes.sourceState=empty 時回非空 indices(可以回但前端會打標)
