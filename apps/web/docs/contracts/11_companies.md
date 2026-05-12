# Contract: 公司列表 (/companies) + 公司詳情 (/companies/[symbol])

## 1. 首屏要回答什麼問題

**列表頁**：Operator 從 3470 家公司中快速找到目標個股，透過搜尋 / 主題 / 受惠層級篩選，進入詳情。

**詳情頁**：Operator 一頁看完個股的即時報價、K 線圖、財務概況、三大法人動向、融資融券，並可發起紙上交易。

---

## 2. 需要哪些 API

**列表頁**

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/companies` | live | 完整公司列表（ticker / name / chainPosition / beneficiaryTier）|

Client-side 搜尋 + 排序 + 分頁（PAGE_SIZE=50），不需要 server-side 搜尋端點。

**詳情頁**

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/companies` | live | 用 symbol 找 companyId（list scan workaround）|
| `GET /api/v1/companies/:id/ohlcv?days=60` | live (FinMind) | K 線 OHLCV 資料（60 天）|
| `GET /api/v1/companies/:id/kbar` | live (FinMind) | 技術指標 K 棒資料（MA/RSI/MACD 前端計算）|
| `GET /api/v1/companies/:id/quote/realtime` | live (KGI EC2) | 即時報價（lastPrice / bid / ask / volume / freshness）|
| `GET /api/v1/companies/:id/themes` | live | 相關主題列表 |
| `GET /api/v1/companies/:id/announcements?days=30` | live (FinMind) | 最近 30 天重大公告 |
| `GET /api/v1/companies/:id/full-profile` | live (FinMind) | 含三大法人 + 融資融券 + 財務資料 |
| `GET /api/v1/kgi/quote/bidask?symbol=...` | live (KGI EC2, 30s poll) | 五檔委買委賣 |
| `GET /api/v1/kgi/quote/ticks?symbol=...&limit=20` | live (KGI EC2, 30s poll) | 最近 20 筆即時成交 |

詳情頁以 `Promise.allSettled` 並行取得；各 panel 獨立降級，不因一個 panel 失敗就 block 整頁。

---

## 3. 五種 State 語言

**列表頁**

| State | 繁中產品語言 |
|---|---|
| loading | "公司列表讀取中…" |
| empty | "找不到符合條件的公司；請調整篩選條件。" |
| stale | — （Client-side，資料即用即顯示）|
| blocked | "公司列表暫時無法讀取（[具體原因]）。" |
| error | "公司列表讀取失敗，請重新整理。" |

**詳情頁 — 即時報價**

| State | 繁中產品語言 |
|---|---|
| live | "即時" (LIVE 綠點 + pulse 動畫) |
| stale | "略舊（更新於 HH:mm）" |
| blocked | "等待即時（[具體原因]）" |

**詳情頁 — 五檔 / 成交**

| State | 繁中產品語言 |
|---|---|
| live | "即時" + pulse 動畫 |
| blocked (auth) | "KGI 尚未授權" |
| blocked (symbol) | "此股票不在訂閱清單" |
| blocked (gateway) | "KGI 連線中斷" |

**詳情頁 — 三大法人 / 融資融券**

| State | 繁中產品語言 |
|---|---|
| live | "最近交易日：YYYY/MM/DD" |
| blocked | "資料暫時無法取得（FinMind 同步異常）" |
| empty | "尚無最新資料" |

---

## 4. 禁止出現的工程詞

- `Company` / `BeneficiaryTier` 型別名稱
- `companyId` UUID 原文（路由可顯示 `[symbol]` 但不顯示內部 UUID）
- `KgiBidAskRaw` / `KgiTickEntry` / `CompanyRealtimeQuote` 型別名稱
- `chg_type: 1/2/3` 原始值（改顯示「買」/ 「賣」/ 「平」）
- `tradingFlow.institutional.latest` / `tradingFlow.marginShort.latest` 欄位路徑
- `quoteFromOhlcvBars` / `toCompanyDetailView` function 名稱
- `OHLCV` 縮寫（顯示「K 線資料」或「日線資料」即可）
- FinMind dataset 代號
- EC2 IP / KGI gateway URL

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 列表頁 KPI bar (5 cell)
type CompaniesKpiBarProps = {
  totalCount: number;
  coreCount: number;       // beneficiaryTier = Core
  directCount: number;
  indirectCount: number;
  statusLabel: "正常" | "無資料" | "需處理";
  statusTone: "ok" | "warn" | "bad";
};

// 公司 row (列表頁)
type CompanyRowProps = {
  ticker: string;
  name: string;
  chainPositionLabel: string;
  beneficiaryTierLabel: "核心" | "直接" | "間接" | "觀察";
  beneficiaryTierTone: "ok" | "warn" | "dim";
  href: string;  // "/companies/[symbol]"
};

// 詳情頁 Hero bar (7 cell)
type CompanyHeroBarProps = {
  symbol: string;
  companyName: string;
  lastPrice: number | null;
  priceChangeLabel: string;   // "+0.50 (+1.23%)"
  priceTone: "up" | "down" | "dim";
  volume: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  quoteStateLabel: "即時" | "略舊" | "等待";
  quoteStateTone: "live" | "stale" | "waiting";
  asOfLabel: string;
};

// K 線圖 (廠商皮 wrapper)
type OhlcvChartContainerProps = {
  bars: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  maEnabled: boolean;
  rsiEnabled: boolean;
  macdEnabled: boolean;
  onIndicatorToggle: (indicator: "ma" | "rsi" | "macd", enabled: boolean) => void;
};

// 五檔委買委賣
type BidAskPanelProps = {
  state: "live" | "blocked";
  blockedReason?: string;
  askLevels: Array<{ price: number; volume: number }>;  // 5 levels
  bidLevels: Array<{ price: number; volume: number }>;
  midPrice: number | null;
};

// 即時成交 stream
type TickStreamPanelProps = {
  state: "live" | "blocked";
  ticks: Array<{
    time: string;
    price: number;
    volume: number;
    directionLabel: "買" | "賣" | "平";
    directionTone: "up" | "down" | "dim";
  }>;
};

// 三大法人 KPI
type InstitutionalKpiProps = {
  state: "live" | "blocked" | "empty";
  dateLabel: string;
  foreignNetBuyLabel: string;   // "+XXX 萬張" 或 "--"
  foreignTone: "ok" | "bad" | "dim";
  investTrustLabel: string;
  dealerLabel: string;
  totalNetBuyLabel: string;
};

// 融資融券 KPI
type MarginShortKpiProps = {
  state: "live" | "blocked" | "empty";
  dateLabel: string;
  marginBalanceLabel: string;  // "X.X 萬"
  marginChangeTone: "ok" | "bad" | "dim";
  shortBalanceLabel: string;
  shortChangeTone: "ok" | "bad" | "dim";
};

// 紙上交易 CTA
type PaperOrderPanelProps = {
  symbol: string;
  companyName: string;
  execModeLabel: "紙上交易" | "真實下單";
  killSwitchLabel: "守住" | "開啟";
  onPreview: (input: PaperOrderInput) => Promise<PaperOrderPreview>;
  onSubmit: (input: PaperOrderInput) => Promise<void>;
};

// 預留 hook
interface VendorSwapHook {
  onCompanyListReady?: (kpi: CompaniesKpiBarProps, companies: CompanyRowProps[]) => void;
  onCompanyDetailReady?: (hero: CompanyHeroBarProps) => void;
}
```
