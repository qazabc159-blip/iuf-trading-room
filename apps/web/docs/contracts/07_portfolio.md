# Contract: 紙上交易室 / 投資組合 (/portfolio)

## 1. 首屏要回答什麼問題

Operator 確認目前所有虛擬持倉狀態、成交紀錄與系統健康狀態，以及下單功能是否正常開啟。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/paper/portfolio` | live | 持倉列表（symbol / quantity / avgCost / marketValue / unrealizedPnl）|
| `GET /api/v1/paper/fills` | live | 成交紀錄（symbol / side / quantity / price / fillTime）|
| `GET /api/v1/paper/health` | live | 系統健康（killSwitchEngaged / execMode / lastOrderAt）|
| `GET /api/v1/kgi/positions` | live (KGI EC2) | 即時券商持倉（read-only）；gateway 離線時降級不 block 主頁 |

PAPER_CAPITAL_TWD = 20,000 TWD（固定常數，開發資金上限，非可配置）。

---

## 3. 五種 State 語言

**持倉**

| State | 繁中產品語言 |
|---|---|
| loading | "持倉讀取中…" |
| empty | "目前沒有模擬持倉；先從公司頁開啟紙上交易預覽。" |
| stale | "持倉資料較舊（上次更新：HH:mm）；系統在重新整理中。" |
| blocked | "持倉服務暫時無法讀取（[具體原因]）。" |
| error | "持倉讀取失敗，請重新整理。" |

**系統健康**

| State | 繁中產品語言 |
|---|---|
| live | "系統正常" |
| blocked (kill switch) | "守住 — 下單功能暫停中" |
| blocked (paper mode) | "目前紙上交易模式（虛擬下單）" |
| blocked (other) | "系統守住（[具體原因]）" |

---

## 4. 禁止出現的工程詞

- `PaperPortfolioPosition` / `PaperFillLedgerRow` / `KgiLivePosition` 型別名稱
- `KgiPositionsResponse` / `PaperHealthState` 型別名稱
- `PAPER_CAPITAL_TWD` 常數名稱
- `killSwitchEngaged: true/false` 原始 boolean 顯示
- `execMode` enum 值原文（如 `PAPER` / `LIVE`）
- `/api/v1/paper/*` 路徑原文顯示給使用者
- `unrealizedPnl` 欄位名稱（顯示為「未實現損益」）

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 頁面 KPI bar (8 cell)
type PortfolioKpiBarProps = {
  positionCount: number;
  totalMarketValueLabel: string;  // "NT$ XX,XXX"
  totalPnlLabel: string;          // "+NT$ XXX" / "-NT$ XXX"
  totalPnlTone: "ok" | "bad" | "dim";
  fillCount: number;
  capitalUsedPct: number;         // 0-100
  systemStatusLabel: "正常" | "守住" | "紙上交易";
  systemStatusTone: "ok" | "warn" | "bad";
};

// 持倉 row
type PositionRowProps = {
  symbol: string;
  quantity: number;
  quantityUnitLabel: "張" | "股";
  avgCostLabel: string;        // "NT$ XX.XX"
  marketValueLabel: string;    // "NT$ XX,XXX"
  unrealizedPnlLabel: string;  // "+NT$ XXX"
  unrealizedPnlTone: "ok" | "bad" | "dim";
  href: string;                // "/companies/[symbol]"
};

// 成交紀錄 row
type FillRowProps = {
  symbol: string;
  sideLabel: "買進" | "賣出";
  sideTone: "up" | "down";
  quantity: number;
  quantityUnitLabel: "張" | "股";
  priceLabel: string;          // "NT$ XX.XX"
  fillTimeLabel: string;       // "MM/DD HH:mm"
};

// 系統健康 card
type PortfolioHealthCardProps = {
  killSwitchLabel: "運行中" | "守住";
  killSwitchTone: "ok" | "bad";
  execModeLabel: "紙上交易" | "真實下單" | "未知";
  lastOrderAtLabel: string | null;
};

// KGI 即時持倉 (optional panel，gateway 離線時不顯示)
type KgiPositionPanelProps = {
  positions: Array<{ symbol: string; quantity: number; avgCostLabel: string }>;
  state: "live" | "blocked";
  blockedReason?: string;
};

// 預留 hook
interface VendorSwapHook {
  onPortfolioReady?: (kpi: PortfolioKpiBarProps, positions: PositionRowProps[]) => void;
}
```
