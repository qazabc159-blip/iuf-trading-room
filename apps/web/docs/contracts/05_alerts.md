# Contract: 警示中心 (/alerts)

## 1. 首屏要回答什麼問題

Operator 即時掌握今日有哪些風控條件觸發、哪些規則 24h 內保持靜默，並確認警示引擎是否正常運行。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/alerts?limit=50` | live | 警示事件列表（含 ruleId / severity / triggeredAt / ticker）|
| `POST /api/v1/internal/alerts/dispatch` | live (Owner only) | 手動觸發警示引擎一次（Owner 角色限定）|

**規則目錄** (`RULE_CATALOGUE`) 是前端靜態常數（10 條規則描述），「最近觸發時間」由真實 alerts API 結果 derive，不是假資料。

---

## 3. 五種 State 語言

| State | 繁中產品語言 |
|---|---|
| loading | "警示讀取中…" |
| empty | "目前 24h 無事件觸發 — 引擎正常運行，無資料波動達到觸發門檻。如預期看到事件未顯示，請告知（可能 FinMind 同步異常）。" |
| stale | — （警示無 stale 語意；有就顯示，無就 empty）|
| blocked | "警示服務暫時無法連線（需要登入或資料庫異常）。" |
| error | "警示資料讀取失敗，請重新整理。" |

**各規則 sub-state**

| State | 繁中產品語言 |
|---|---|
| 24h 內有觸發 | "最近觸發：MM/DD HH:mm" |
| 24h 內無觸發 | "24h 內無觸發記錄" |

---

## 4. 禁止出現的工程詞

- `AlertsEngineState` 型別名稱
- `lastTickAt` / `lastTickEvents` / `totalEventsThisProcess` 欄位名稱
- `ruleId` 原始值（如 `R01_REVENUE_SURGE_YOY50`）
- `AlertSeverity` enum 值原文
- `AlertsAuthError` / `AlertsListResponse` 類別名稱
- FinMind dataset 代號（如 `tw_institutional_buysell`）
- `/api/v1/internal/...` 路徑原文顯示給使用者

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 頁面 KPI bar
type AlertsKpiBarProps = {
  todayCount: number;
  unreadCount: number;
  engineStatusLabel: "運行中" | "等待" | "異常";
  engineStatusTone: "ok" | "warn" | "bad";
  lastTickLabel: string; // "MM/DD HH:mm" 或 "--"
};

// 警示 event card
type AlertCardProps = {
  id: string;
  ruleLabel: string;    // 中文規則說明，不秀 ruleId
  severityLabel: "資訊" | "注意" | "重要";
  severityTone: "dim" | "warn" | "bad";
  ticker: string | null;
  triggeredAtLabel: string; // "MM/DD HH:mm"
  acknowledged: boolean;
  payloadSummary: string | null; // 人可讀摘要，不秀 JSON
};

// 規則目錄 row
type RuleCatalogueRowProps = {
  label: string;        // 中文規則名稱
  desc: string;         // 中文說明
  dataSourceLabel: string; // "三大法人資料" 等，不秀 FinMind dataset ID
  severityLabel: string;
  lastFiredLabel: string; // "最近觸發：HH:mm" 或 "24h 內無觸發記錄"
};

// Owner-only dispatch 按鈕
type AlertDispatchButtonProps = {
  visible: boolean;         // Server-side role check
  onDispatch: () => Promise<{ newEvents: number }>;
  state: "idle" | "loading" | "done" | "error";
  resultMessage: string | null;
};

// 頁面主狀態
type AlertsPageState = "LIVE" | "EMPTY" | "BLOCKED";

// 預留 hook
interface VendorSwapHook {
  onAlertsReady?: (state: AlertsPageState, alerts: AlertCardProps[]) => void;
}
```
