# Contract: 每日簡報列表 (/briefs)

## 1. 首屏要回答什麼問題

Operator 確認今日簡報是否已發布、上次審核結果，並可快速搜尋歷史簡報找到特定日期或關鍵詞的記錄。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/briefs` | live | 所有已發布簡報列表（含 date / title / marketState / status）|
| `GET /api/v1/content-drafts` | live | 草稿審核佇列，顯示待審數量 |
| `GET /api/v1/openalice/observability` | live | AI 生成引擎健康狀態 |
| `GET /api/v1/openalice/jobs` | live | 目前佇列中工作 |
| `GET /api/v1/openalice/dispatcher/debug` | live | 排程觸發紀錄 |
| `POST /api/v1/briefs/search?q=...&from=...&to=...` | live | 關鍵字 + 日期區間搜尋（PR #325 FTS）|

搜尋 debounce 350ms，關鍵字 `<mark>` amber 高亮。

---

## 3. 五種 State 語言

**簡報列表**

| State | 繁中產品語言 |
|---|---|
| loading | "簡報載入中…" |
| empty | "今日尚無已發布簡報；AI 生成佇列持續運行，完成後自動更新。" |
| stale | "顯示的是舊版簡報（上次更新：HH:mm）；今日版本尚在處理中。" |
| blocked | "簡報服務暫時無法讀取（[具體原因]）；請確認 AI 工作引擎狀態。" |
| error | "簡報讀取失敗，請重新整理。" |

**搜尋結果**

| State | 繁中產品語言 |
|---|---|
| loading | "搜尋中…" |
| empty | "找不到符合「[關鍵字]」的簡報。" |
| blocked | "搜尋服務暫時無法使用。" |
| error | "搜尋失敗，請稍後再試。" |

---

## 4. 禁止出現的工程詞

- `OpenAliceObservability` / `OpenAliceDispatcherDebug` 型別名稱
- `openalice` 任何形式（包含 URL 中）
- `deviceId` / `taskType` / `contextRefs`
- `DailyBriefSurface` state enum value（AWAITING_REVIEW / MISSING 等）
- 搜尋 FTS / ILIKE / GIN index 術語
- `contentDraftSections` helper 名稱
- `briefAgeDays` / `briefAgeCopy` function 名稱

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 簡報 card
type BriefCardProps = {
  id: string;
  date: string;           // "YYYY/MM/DD"
  title: string;
  marketStateLabel: string; // "多頭偏好" | "空頭偏好" | "均衡觀望"
  marketStateTone: "ok" | "warn" | "dim";
  ageLabel: string;       // "今天" | "昨天" | "N 天前"
  sectionCount: number;
  href: string;           // "/briefs/[id]"
};

// 搜尋 bar
type BriefSearchBarProps = {
  query: string;
  fromDate: string | null;
  toDate: string | null;
  onChange: (query: string) => void;
  onFromDate: (date: string | null) => void;
  onToDate: (date: string | null) => void;
  onClear: () => void;
  isLoading: boolean;
};

// 搜尋結果 item
type BriefSearchResultProps = {
  id: string;
  title: string;            // keyword 已 <mark> 高亮
  snippet: string;          // 前 160 字，keyword 已高亮
  date: string;
  href: string;
};

// AI 引擎狀態 badge
type BriefEngineStatusProps = {
  label: "運行中" | "延遲" | "異常" | "等待";
  queueCount: number;       // 佇列工作數
  lastGenAt: string | null; // "MM/DD HH:mm"
};

// 頁面主狀態
type BriefPageState = "PUBLISHED" | "AWAITING_REVIEW" | "MISSING" | "BLOCKED";

// 草稿佇列 badge（Owner / Admin 可見）
type DraftQueueBadgeProps = {
  pendingCount: number;
  href: string;  // "/admin/content-drafts"
};

// 預留 hook
interface VendorSwapHook {
  onBriefListReady?: (state: BriefPageState, briefs: BriefCardProps[]) => void;
}
```
