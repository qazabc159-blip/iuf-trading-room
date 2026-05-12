# Contract: 首頁 (/)

## 1. 首屏要回答什麼問題

Operator 在開盤前一眼看到今日市場情緒、最新研究摘要、警示狀態與策略研究批次是否就緒。

---

## 2. 需要哪些 API

| Endpoint | Source | Cache |
|---|---|---|
| `GET /api/v1/dashboard/snapshot` | live (Railway) | 30s server cache |
| `GET /api/v1/briefs` | live | force-dynamic |
| `GET /api/v1/market-intel/announcements?companyIds=...` | live (FinMind) | force-dynamic |
| `GET /api/v1/market-intel/news-top10` | live | force-dynamic |
| `GET /api/v1/finmind/status` | live | force-dynamic |
| `GET /api/v1/finmind/diagnostics` | live | force-dynamic |
| `GET /api/v1/kgi/quote/status` | live (KGI EC2) | force-dynamic |
| `GET /api/v1/ops/snapshot` | live | force-dynamic |
| `GET /api/v1/strategy/ideas?limit=5` | live | force-dynamic |
| `GET /api/v1/strategy/runs?limit=3` | live | force-dynamic |
| `GET /api/v1/paper/health` | live | force-dynamic |
| `GET /api/v1/content-drafts` | live | force-dynamic |

所有 fetch 以 `Promise.allSettled` 並行；每個 fetch 包有 soft=3000ms / hard=5000ms timeout，超時顯示 BLOCKED 不顯示空白。

---

## 3. 五種 State 語言

| State | 繁中產品語言 |
|---|---|
| loading | "資料準備中，請稍候…" |
| empty | "今日尚無新資料；市場資料系統運行中，等待下一次更新。" |
| stale | "資料較舊（上次更新：HH:mm）；若需最新請重新整理。" |
| blocked | "資料暫時無法取得（原因：[具體說明]）；等候系統恢復後自動更新。" |
| error | "頁面讀取發生問題，請重新整理。若持續出現，請告知。" |

> Dashboard Skeleton 在 Suspense fallback 中，< 200ms 內送出結構。

---

## 4. 禁止出現的工程詞

- `Promise.allSettled` / `force-dynamic` / `withTimeout`
- `BLOCKED_timeout_5000ms` / `_timeout` sentinel 任何形式
- `FinMindSourceStatus` / `OpsSnapshotData` / enum value 原文
- railway URL / EC2 IP / session cookie 名稱
- migration 檔名 / SQL table 名稱
- `gpt-4.1` / `openalice` / `deviceId` / `taskType`

---

## 5. 廠商設計回來時接哪些 Props

```ts
// Hero KPI (DashboardSnapshot)
type HeroKpiProps = {
  todayBriefState: "已發布" | "待審核" | "尚無" | "暫停";
  marketStateLabel: "多頭偏好" | "空頭偏好" | "均衡觀望";
  signalCount: number;
  alertCount: number;
  paperHealthLabel: "正常" | "守住" | "需處理";
  kgiQuoteLabel: "即時" | "略舊" | "等待";
};

// 今日簡報 card
type BriefCardProps = {
  title: string;
  date: string;         // "YYYY/MM/DD"
  marketStateLabel: string;
  sectionCount: number;
  snippetText: string;  // 前160字
  href: string;         // "/briefs/[id]"
};

// 市場情報 announcement list
type IntelCardProps = {
  ticker: string;
  companyName: string;
  headline: string;     // cleanExternalHeadline() 過濾後
  publishedAt: string;
  kind: "material" | "financial" | "general";
};

// 策略研究 KPI strip
type StrategyKpiProps = {
  latestRunAt: string | null;
  totalIdeas: number;
  allowCount: number;
  reviewCount: number;
  blockCount: number;
};

// 警示 strip
type AlertStripProps = {
  todayCount: number;
  unreadCount: number;
  severity: "info" | "warning" | "critical" | "none";
};

// 預留 hook
interface VendorSwapHook {
  onHeroKpiReady?: (props: HeroKpiProps) => void;
  onIntelReady?: (items: IntelCardProps[]) => void;
}
```
