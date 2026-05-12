# Contract: 量化研究室 (/lab, /lab/three-strategy, /lab/three-strategy/[strategyId])

## 1. 首屏要回答什麼問題

Operator 了解目前三條量化策略的研究狀態（哪條通過、哪條退場、哪條在實驗中），以及是否已有候選策略進入紙上交易模式。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/lab/three-strategy/snapshot` | live | 三策略聚合快照（含 strategyId / stage / equityCurve / kpi）|
| `GET /api/v1/lab/strategy/:strategyId/snapshot` | live | 單策略詳細快照（含月報酬 / 最大回撤 / Sharpe / 示範交易）|
| `GET /api/v1/lab/bundles` | live (radarLabApi) | 舊研究 bundle 列表（保留相容，不是主路徑）|
| `PATCH /api/v1/lab/strategy/:strategyId/mode` | live (Owner only) | 切換策略模式（OFF / PAPER / LIVE）|

端點 stale 時（`created_at_taipei` 超過預期）顯示 amber 警告 banner，不 block 整頁。  
端點失敗時降級到 `FALLBACK_STRATEGIES` 靜態數據 + stale reason banner。

---

## 3. 五種 State 語言

**入口頁 (/lab)**

| State | 繁中產品語言 |
|---|---|
| loading | "研究室狀態讀取中…" |
| empty | "目前三策略尚無快照資料；等候研究系統下次更新。" |
| stale | "顯示的是較早版本的策略狀態（更新於：MM/DD HH:mm）；請留意資料可能不是最新。" |
| blocked | "策略快照暫時無法讀取（[具體原因]）；顯示備援資料。" |
| error | "研究室讀取失敗，請重新整理。" |

**策略詳情頁**

| State | 繁中產品語言 |
|---|---|
| loading | "策略詳情讀取中…" |
| empty | "此策略尚無完整回測資料。" |
| stale | — （由聚合端點 stale banner 統一顯示）|
| blocked | "策略詳情暫時無法讀取。" |
| error | "找不到此策略；可能是連結有誤。請返回研究室清單。" |

**退場策略（RETIRED）**

以低透明度 + 刪除線 + 靜態展示，不顯示切換 CTA。

---

## 4. 禁止出現的工程詞

- `ATHENA_5_9_OVERRIDES` / `FALLBACK_STRATEGIES` / `STAGE2_SNAPSHOTS` 常數名稱
- `cont_liq_v36` / `rs_20_60_low_drawdown__h20__top5` / `MAIN_execution_rank_buffer_top20` 原始策略 ID
- `RESEARCH_CANDIDATE` / `PAPER_LIVE_PROPOSED` / `KILL_NO_EDGE` / `SELECTION_DOMINANT_SECTOR_DEPENDENT` enum value
- `yang_explicit_ack` / `capital_twd` API 欄位名稱顯示給使用者
- Sharpe ratio / Bonferroni / DSR / CPCV / PBO 等量化專業術語（除非在說明文本中有明確注解）
- `radarLabApi.bundles()` function 名稱
- `notFound()` Next.js function 名稱

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 策略 hero card (列表頁，3張)
type StrategyHeroCardProps = {
  displayName: string;      // 中文名稱，如「流動順勢三強」
  stageLabel: string;       // "研究候選" | "紙上觀察中" | "已退場" | "實驗中"
  stageTone: "amber" | "blue" | "dim" | "violet";
  badgeColor: "amber" | "blue" | "violet";
  isRetired: boolean;
  caveatSummary: string;    // 警示文字（全文不截斷）
  equityCurvePoints: number[] | null; // 用於 mini sparkline
  isPendingChart: boolean;  // true 則顯示 dashed placeholder
  kpiLabel: string;         // "9/9 通過" 等
  href: string | null;      // null 時 = 退場策略，不可點擊
};

// 策略 KPI grid (詳情頁)
type StrategyKpiGridProps = {
  sharpeLabel: string;         // "3.03" amber glow
  maxDrawdownLabel: string;    // "-8.2%"
  winRateLabel: string;        // "62%"
  sampleTradesLabel: string;   // "47 筆示範"
  yearReturnLabel: string;     // "+22.0%"
  robustnessLabel: string;     // "4 項通過"
  capacityWarning: string | null; // 容量警示文字
};

// 月報酬 bar chart data
type MonthlyReturnBarProps = {
  month: string;     // "2024-01"
  returnPct: number; // 正/負
  tone: "ok" | "bad";
};

// 策略模式切換（Owner only）
type StrategyModeToggleProps = {
  currentMode: "研究中" | "紙上觀察" | "真實交易";
  canToggle: boolean;       // Owner 角色
  onToggle: (targetMode: "OFF" | "PAPER" | "LIVE") => Promise<void>;
  requiresConfirm: boolean; // LIVE 需要雙重確認
};

// 退場策略靜態展示
type RetiredStrategyPanelProps = {
  displayName: string;
  retiredReason: string;  // 退場原因全文
  retiredAt: string | null;
};

// 預留 hook
interface VendorSwapHook {
  onLabReady?: (strategies: StrategyHeroCardProps[]) => void;
  onStrategyDetailReady?: (kpi: StrategyKpiGridProps) => void;
}
```
