# Contract: 訊號牆 (/signals)

## 1. 首屏要回答什麼問題

Operator 快速瀏覽研究團隊產生的所有正式訊號，按主題或公司篩選，找出目前最值得關注的機會方向。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/signals` | live | 所有訊號（含 themeId / companyId / category / direction / confidence）|
| `GET /api/v1/themes` | live | 主題列表（用於顯示主題標籤）|
| `GET /api/v1/companies` | live | 公司列表（用於顯示公司名稱 / ticker）|

三支 API 以 `Promise.all` 並行取得。

---

## 3. 五種 State 語言

| State | 繁中產品語言 |
|---|---|
| loading | "訊號資料讀取中…" |
| empty | "目前沒有可顯示的正式訊號；等候研究批次產生後更新。" |
| stale | "訊號資料較舊（上次更新：HH:mm）；等候下次研究批次。" |
| blocked | "訊號資料暫時無法讀取（[具體原因]）。" |
| error | "訊號資料讀取失敗，請重新整理。" |

---

## 4. 禁止出現的工程詞

- `Signal` / `SignalCreateInput` 型別名稱
- `themeId` / `companyId` UUID 原文顯示
- category field 原始 string value
- `getSignals` / `getThemes` / `getCompanies` function 名稱
- `sourceFreshnessLabel` helper 名稱
- `cleanExternalHeadline` 函數名稱

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 頁面 KPI bar
type SignalsKpiBarProps = {
  totalCount: number;
  themeCount: number;
  companyCount: number;
  statusLabel: "可用" | "尚無訊號" | "需處理";
  statusTone: "ok" | "warn" | "bad";
};

// 訊號 card
type SignalCardProps = {
  id: string;
  headline: string;       // 訊號標題（cleanExternalHeadline 淨化後）
  themeLabel: string;     // 主題中文名稱
  companyTicker: string | null;
  companyName: string | null;
  directionLabel: "偏多" | "偏空" | "中性";
  directionTone: "up" | "down" | "dim";
  confidence: number | null; // 0-1
  confidenceLabel: string | null; // "高" | "中" | "低"
  categoryLabel: string;
  createdAtLabel: string; // "MM/DD HH:mm"
};

// filter bar
type SignalFilterProps = {
  themes: Array<{ id: string; label: string }>;
  companies: Array<{ id: string; ticker: string; name: string }>;
  selectedThemeId: string | null;
  selectedCompanyId: string | null;
  selectedDirection: "bullish" | "bearish" | "neutral" | null;
  onThemeChange: (id: string | null) => void;
  onCompanyChange: (id: string | null) => void;
  onDirectionChange: (dir: string | null) => void;
};

// 頁面主狀態
type SignalsPageState = "LIVE" | "EMPTY" | "BLOCKED";

// 預留 hook
interface VendorSwapHook {
  onSignalsReady?: (state: SignalsPageState, signals: SignalCardProps[]) => void;
}
```
