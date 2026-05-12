# Contract: 策略想法 (/ideas)

## 1. 首屏要回答什麼問題

Operator 瀏覽最新一輪策略候選，看每個想法的方向判斷、品質評級與理由，決定是否發起研究批次。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&limit=30&sort=score` | live | 策略想法列表（含 direction / quality / decision / rationale / score / confidence）|

URL query 參數在廠商設計接皮後必須保持 round-trip（filter / sort 不能丟失）。

---

## 3. 五種 State 語言

| State | 繁中產品語言 |
|---|---|
| loading | "策略想法讀取中…" |
| empty | "目前沒有可顯示的正式策略想法；等候下次研究批次產生後更新。" |
| stale | "顯示的是較早一批策略想法（產生於：MM/DD HH:mm）；下批次執行後自動更新。" |
| blocked | "策略想法暫時無法讀取（[具體原因]）。" |
| error | "策略想法讀取失敗，請重新整理。" |

---

## 4. 禁止出現的工程詞

- `StrategyIdeasDecisionFilter` / `StrategyIdeasDecisionMode` / `StrategyIdeasQualityFilter` enum value
- `StrategyIdeasView` / `StrategyIdeasSort` 型別名稱
- `decisionMode=paper` 顯示為 "紙上交易模式" 即可，不秀 param key
- `includeBlocked=true` 不顯示
- `getStrategyIdeas` function 名稱
- `sourceFreshnessLabel` / `cleanNarrativeText` helper 名稱
- `reasonLabel` function 名稱（改為顯示中文 rationale 文字）

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 頁面 KPI bar (7 cell)
type IdeasKpiBarProps = {
  statusLabel: "可用" | "尚無想法" | "需處理";
  statusTone: "ok" | "warn" | "bad";
  totalCount: number;
  allowCount: number;
  reviewCount: number;
  blockCount: number;
  strategyReadyCount: number;
  generatedAtLabel: string; // "MM/DD HH:mm" 或 "--"
};

// 想法 card (candidate)
type IdeaCardProps = {
  id: string;
  ticker: string;
  companyName: string;
  themeLabel: string | null;
  directionLabel: "偏多" | "偏空" | "中性";
  directionTone: "up" | "down" | "dim";
  decisionLabel: "建議進場" | "待審核" | "不建議進場";
  decisionTone: "ok" | "warn" | "bad";
  qualityLabel: "策略就緒" | "僅供參考" | "資料不足";
  qualityTone: "ok" | "warn" | "bad";
  score: number | null;       // 0-1
  confidence: number | null;  // 0-1
  rationale: string;          // 中文說明文字
  href: string;               // "/companies/[symbol]"
};

// 操作 CTA（Save Run）
type SaveRunCtaProps = {
  onSaveRun: () => Promise<{ runId: string }>;
  state: "idle" | "loading" | "done" | "error";
  disabled: boolean;
  disabledReason?: string;
};

// filter / sort bar
type IdeasFilterProps = {
  decisionFilter: "all" | "allow" | "review" | "block";
  qualityFilter: "all" | "strategy_ready" | "reference_only";
  directionFilter: "all" | "bullish" | "bearish" | "neutral";
  sort: "score" | "created_at";
  onDecisionChange: (f: string) => void;
  onQualityChange: (f: string) => void;
  onDirectionChange: (f: string) => void;
  onSortChange: (s: string) => void;
};

// 預留 hook
interface VendorSwapHook {
  onIdeasReady?: (kpi: IdeasKpiBarProps, ideas: IdeaCardProps[]) => void;
}
```
