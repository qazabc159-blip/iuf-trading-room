# Contract: 研究批次 (/runs) + 批次詳情 (/runs/[id])

## 1. 首屏要回答什麼問題

**列表頁**：Operator 看到所有策略研究批次的執行狀態與品質摘要，選擇某一批次深入審查。

**詳情頁**：Operator 審閱單次批次的所有候選股票輸出、品質評級，決定是否送出確認。

---

## 2. 需要哪些 API

**列表頁**

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/strategy/runs?decisionMode=paper&limit=50&sort=created_at` | live | 研究批次列表 |

**詳情頁**

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/strategy/runs/:id` | live | 單次批次詳情（含 outputs / items / quality / rationale / lineage）|
| `GET /api/v1/strategy/runs?limit=50` | live | 側邊欄導覽（同列表但用於側欄批次選擇）|

query round-trip：`/runs` → `/runs/[id]` 必須保留所有 filter 參數，不能丟失。

---

## 3. 五種 State 語言

**列表頁**

| State | 繁中產品語言 |
|---|---|
| loading | "研究批次讀取中…" |
| empty | "目前沒有紙上交易研究批次；等候候選資料與市場資料到齊後再產生。" |
| stale | "研究批次資料較舊（上次更新：MM/DD HH:mm）。" |
| blocked | "研究批次暫時無法讀取（[具體原因]）。" |
| error | "讀取失敗，請重新整理。" |

**詳情頁**

| State | 繁中產品語言 |
|---|---|
| loading | "批次詳情讀取中…" |
| empty | "策略批次存在，但沒有產出候選股票；可能是此次篩選條件過嚴。" |
| stale | — |
| blocked | "批次詳情暫時無法讀取（[具體原因]）。" |
| error | "找不到這個批次，可能連結有誤。" |

---

## 4. 禁止出現的工程詞

- `StrategyRunListView` / `StrategyRunRecord` 型別名稱
- `decisionMode=paper` param 不顯示
- `listStrategyRuns` / `getStrategyRunById` function 名稱
- `generatedAt` 欄位名稱原文
- `quality.strategyReady` / `quality.referenceOnly` / `quality.insufficient` 欄位名稱
- `reasonLabel` function 名稱
- `lineage` 欄位名稱（顯示為「研究脈絡」）

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 批次 card (列表頁)
type RunCardProps = {
  id: string;
  decisionModeLabel: "紙上交易研究" | "策略研究" | "實盤前檢查";
  directionLabel: "偏多研究" | "偏空研究" | "中性觀察";
  directionTone: "up" | "down" | "dim";
  qualityLabel: string;  // e.g. "策略就緒 12 / 參考 8 / 不足 3"
  generatedAtLabel: string; // "MM/DD HH:mm"
  outputCount: number;
  href: string;  // "/runs/[id]"
};

// 列表頁 KPI bar
type RunsKpiBarProps = {
  totalBatches: number;
  statusLabel: "可用" | "尚無批次" | "需處理";
  statusTone: "ok" | "warn" | "bad";
  readyCount: number;    // 所有批次合計 strategyReady
  referenceCount: number;
  updatedAtLabel: string;
};

// 批次詳情 KPI bar (6 cell)
type RunDetailKpiBarProps = {
  statusLabel: string;
  statusTone: "ok" | "warn" | "bad";
  totalCandidates: number;
  observableCount: number;
  pendingCount: number;
  notInFlowCount: number;
  strategyUsable: boolean;
};

// 批次輸出 item
type RunOutputItemProps = {
  ticker: string;
  companyName: string;
  decisionLabel: "建議進場" | "待審核" | "不建議進場";
  decisionTone: "ok" | "warn" | "bad";
  qualityLabel: "策略就緒" | "僅供參考" | "資料不足";
  rationale: string;
  score: number | null;
  href: string;  // "/companies/[symbol]"
};

// lineage panel (研究脈絡)
type LineagePanelProps = {
  sourceRunId: string | null;
  ideaCount: number;
  themeLabels: string[];
};

// 批次側欄 navigator
type RunNavigatorProps = {
  runs: Array<{ id: string; label: string; isActive: boolean; href: string }>;
};

// 預留 hook
interface VendorSwapHook {
  onRunListReady?: (kpi: RunsKpiBarProps, runs: RunCardProps[]) => void;
  onRunDetailReady?: (kpi: RunDetailKpiBarProps, outputs: RunOutputItemProps[]) => void;
}
```
