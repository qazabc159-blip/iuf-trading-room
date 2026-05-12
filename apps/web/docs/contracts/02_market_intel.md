# Contract: 市場情報 (/market-intel)

## 1. 首屏要回答什麼問題

Operator 確認今日重要公司公告與市場新聞，判斷是否有需要即時關注的個股異動。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/market-intel/announcements?companyIds=...&days=30` | live (FinMind) | 最近 30 天重大公告，最多 16 家公司同時查 |
| `GET /api/v1/market-intel/news-top10` | live | AI 精選前 10 條市場新聞 |
| `GET /api/v1/finmind/status` | live | FinMind 資料源健康狀態 |

FinMind 連線異常時，公告列表進入 BLOCKED 狀態顯示具體原因；新聞 top10 獨立降級，不連動。

---

## 3. 五種 State 語言

| State | 繁中產品語言 |
|---|---|
| loading | "市場情報讀取中…" |
| empty | "近期無新公告紀錄；FinMind 資料源正常，等候下一次同步。" |
| stale | "公告資料較舊（上次同步：HH:mm）；FinMind 仍在處理中。" |
| blocked | "公告服務暫時無法連線（[具體原因]）；請確認 FinMind 訂閱狀態。" |
| error | "市場情報讀取失敗，請重新整理。" |

---

## 4. 禁止出現的工程詞

- `FinMindSourceStatus` / `FinMindDatasetStatus` 任何 enum value
- `ANNOUNCEMENT_DAYS` 常數名稱
- `MAX_QUERY_COMPANIES` 或任何 hardcoded 上限數字
- `companyId` UUID 原文顯示
- `IntelSelectedCompany` 型別名稱
- API query param `companyIds=...` 原文
- FinMind API key / dataset 代號（如 `tw_stock_news`）

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 資料源健康 badge
type DataSourceBadgeProps = {
  finmindLabel: "正常" | "較舊" | "異常" | "未知";
  lastSyncAt: string | null; // "HH:mm" 格式
};

// 公告清單 card
type AnnouncementCardProps = {
  ticker: string;
  companyName: string;
  headline: string;      // cleanExternalHeadline() 淨化
  publishedAt: string;   // "MM/DD HH:mm"
  kind: "material" | "financial" | "general";
  kindLabel: "重大公告" | "財務公告" | "一般公告";
  body?: string;         // 可展開內文（前 300 字）
};

// 新聞 top10 item
type NewsItemProps = {
  headline: string;
  sourceLabel: string;  // 不秀原始 API field
  publishedAt: string;
  score: number | null; // 0-1 relevance，null 時不顯示
};

// 公司篩選 filter
type IntelFilterProps = {
  selectedTickers: string[];  // 最多 16
  onToggle: (ticker: string) => void;
};

// 頁面 state gate（供廠商皮決定是否顯示 fallback UI）
type IntelPageState = "LIVE" | "EMPTY" | "BLOCKED";

// 預留 hook
interface VendorSwapHook {
  onIntelReady?: (state: IntelPageState, items: AnnouncementCardProps[]) => void;
}
```
