# COMPONENTS.md — 11 個 Panel 與資料欄位對應

> 後端改某個欄位時,先查這份表,看哪些 panel 會受影響。Panel 順序 = 畫面從上到下。

---

## 0. 全域結構

```
[頂部跑馬燈]
[頂部命令列:標題 / 搜尋 / 正式下單 BLOCKED]
[任務節奏橫條]
─────────────────────────────────────────
[戰情 Hero]                  [資料源狀態 8 行]
[資料新鮮度時間軸]            [公司池 Heatmap]
[FinMind 資料健康]            [OpenAlice 每日簡報]
[Paper E2E 6 段]              [策略候選 4 檔]
[今日交易工作流 5 動線]        [待處理 4 件]
```

---

## 1. 頂部跑馬燈

**檔案**:`direction-a-v3.jsx` 的 `<Marquee>`
**資料**:`window.IUF_QUOTES` (= API `/quotes`)
**用到的欄位**:
- `sourceState` — 若為 `"empty"`,顯示「市場資料 EMPTY · 以下為示意」徽章
- `indices` / `flows` / `stocks` — 全部串成跑馬燈

**注意**:跑馬燈是 CSS 動畫無限循環,後端只要每 30s 更新陣列即可,前端會無痛換新。

---

## 2. 頂部命令列

**資料**:`IUF_DATA.meta`
- `meta.nowText` → 右側時間戳
- `meta.formalOrder.state` → "BLOCKED" 紅色徽章

---

## 3. 任務節奏橫條 (AgendaTimeline)

**資料**:`window.IUF_AGENDA` (= API `/agenda`)
- `time` / `label` / `state` 三欄位都用到
- `state="now"` 的點會閃爍

---

## 4. 戰情 Hero (左半)

5 段式狀態列:
- OBSERVE 模式 — hardcoded
- OPERATOR — `meta.operator`
- SESSION — `<HeartbeatClock>`(本地遞增,不需要 API)
- NEXT ACTION — 從 `sources` 推導(找出第一個 stale/empty 的來源,組成「檢查 X → 確認 Y」)
- BLOCKED — `meta.formalOrder.state`

加權指數區:
- `quotes.indices[0]` (TWII) — price / chg / pct
- `quotes.intradayTwii` — 60 點分時走勢

漲跌家數區:
- `breadth.up / flat / down / total`

4 KPI:
- 可用來源 = `sources.filter(s => s.status === "live").length`
- 需處理 = `sources.filter(s => s.status === "stale" || s.status === "empty").length`
- 交易能力 = "Paper" (hardcoded)
- 正式下單 = `meta.formalOrder.state`

---

## 5. 資料源狀態 (右半)

**資料**:`IUF_DATA.sources` (= API `/sources`)
**每行 5 欄**:`name` / `desc` / sparkline(前端模擬) / `updated` / `<StatusChip status>`

點任一行 → drawer 開啟 → call `GET /sources/{key}` 取 `SourceDetail`

---

## 6. 資料新鮮度時間軸

**資料**:`sources.lastUpdateAt` 計算 staleness,對數刻度繪製
- 同一時間 bucket 的多個來源會堆疊(已修正過重疊問題)
- 顯示計數圈標籤,e.g. ⑤

---

## 7. 公司池 Heatmap

**資料**:`window.IUF_HEATMAP` (= API `/heatmap`)
- 第 1 大(台積電)獨佔左半 2 列
- 第 2 大佔右上 2 列
- 接著上排 4 檔小、下三列每列 5 檔
- **如果 sourceState=empty,整塊打「EMPTY · 示意」標籤**
- 顏色:**紅漲綠跌**(台股慣例),強度按 |pct|

---

## 8. FinMind 資料健康

**資料**:`IUF_DATA.finmind` (= API `/finmind/health`)
4 KPI:
- Token → `tokenPresent` boolean(顯示「存在」/「不存在」)
- Quota → `quotaUsed` / `quotaTotal` 進度條
- 資料集 → `datasets.ok / downgraded / blocked`
- 最近請求 → `recentRequest.name` + `recentRequest.at`

請求軌跡:`requests[]` 最近 5 筆,每行 `name` / `at` / `ms` / `ok`

---

## 9. OpenAlice 每日簡報

**資料**:`IUF_DATA.openalice` (= API `/openalice/status`)
4 KPI:Runner / Dispatcher / Queue / 已發布
Pipeline 5 段:`pipeline[]` 每段卡片
Source trail 警告條:`sourceTrail.missing[]`

---

## 10. Paper E2E

**資料**:`IUF_DATA.paperE2E` (= API `/paper/e2e`)
- 6 段固定,每段顯示 `id` / `name` / `desc` / `count` / `note`
- 連線:第 i 段到第 i+1 段有漸層線

底部 3 卡:
- Portfolio → `portfolio.cash` / `portfolio.note`
- 單位提示 → hardcoded(1 張 = 1,000 股)
- 正式下單 BLOCKED → `meta.formalOrder.reason`

---

## 11. 策略候選

**資料**:`IUF_DATA.strategyIdeas` (= API `/strategy/ideas`)
4 列表頭:代號 / 名稱 / 立場 / 信心 / 閘門
- `stance` 只能是中性 / 偏多研究 / 偏空研究
- `gate="blocked"` → 顯示紅色閘門
- 底部說明:「立場僅為候選研究,不出現買進/賣出/目標價/獲利保證。」

---

## 12. 今日交易工作流

**資料**:`IUF_DATA.workflow` (= API `/workflow/today`)
5 列,每列 `id` / `title` / `desc` / `state` / `cta` / `href`

---

## 13. 待處理

**資料**:`IUF_DATA.blocked` (= API `/blocked`)
4 列,每列 `name` / `why` / `next` / `icon`
- icon=lock → 顯示 BLOCKED 紅章
- 其他 → 顯示 STALE 黃章

---

## 14. 共用元件 (components.jsx)

| 元件 | 用途 | 資料 |
|---|---|---|
| `<StatusChip status>` | 狀態徽章 | status: SourceState/StepState |
| `<Sparkline points>` | 迷你折線 | number[] |
| `<HeartbeatClock baseTime>` | 遞增時鐘 | hardcoded base |
| `<Counter value>` | 數字滾動 | number |
| `<LiveCounter base jitter interval>` | 微幅波動 | number |
| `<PulseBars count w h color>` | 跳動長條 | hardcoded |
| `<MiniRadar size>` | 旋轉雷達 | none |
| `<CornerMarks>` | 四角準星 | none |
| `<ProgressBar value max color>` | 進度條 | number |
| `<IntradayChart points>` | 分時走勢 | number[] |
| `<BreadthBar b>` | 漲跌家數條 | Breadth |
| `<HeatmapTile s big>` | 單格熱力 | HeatmapTile |
| `<FreshnessTimeline sources>` | 新鮮度時間軸 | SourceStatus[] |
| `<AgendaTimeline items>` | 任務節奏 | AgendaItem[] |
| `<Marquee speed>` | 跑馬燈 | children |
| `<Drawer src>` | 來源 detail 抽屜 | SourceDetail |
| `<CommandPaletteV2>` | Cmd+K | hardcoded |
