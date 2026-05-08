# DATA_CONTRACTS — TypeScript 型別

> 把下面整段 ```ts code block 複製進你的 backend repo,當作前後端 contract 的 single source of truth。
> 對應前端 `frontend/data.js` 裡的 `window.IUF_*` 結構。

```ts
// DATA_CONTRACTS.ts — IUF 戰情台 TypeScript 型別定義
// 可直接複製進 backend repo 當 single source of truth
// 對應前端 frontend/data.js 裡的 window.IUF_* 結構

// ============================================================
// 0. 基礎型別
// ============================================================

/** 8 個資料來源固定 key,順序固定不可改 */
export type SourceKey =
  | "finmind"
  | "kline"
  | "company"
  | "openalice"
  | "topic"
  | "strategy"
  | "signal"
  | "news";

/** 資料來源狀態語意 */
export type SourceState =
  | "live"      // 正常,24h 內有資料
  | "stale"     // 過期 > 24h
  | "empty"     // 從未有資料 / 未接入
  | "review"    // OpenAlice 專用:waiting AI review
  | "blocked"   // 後端阻擋(認證 / 金鑰)
  | "error";    // 上游 crash / timeout

/** Pipeline / Paper E2E 步驟狀態 */
export type StepState = "ok" | "warn" | "wait" | "idle";

/** Workflow 動線狀態 */
export type WorkflowState = "ok" | "wait";

/** Agenda 時間軸狀態 */
export type AgendaState = "done" | "doing" | "now" | "todo";

/** ISO 8601 with +08:00 timezone */
export type IsoTimestamp = string;

// ============================================================
// 1. Top-level snapshot
// ============================================================

export interface DashboardSnapshot {
  meta: Meta;
  sources: SourceStatus[];        // 固定 8 個,順序見 SourceKey
  quotes: Quotes;
  breadth: Breadth;
  heatmap: HeatmapResponse;
  agenda: AgendaItem[];
  finmind: FinmindHealth;
  openalice: OpenAliceStatus;
  paperE2E: PaperStep[];          // 固定 6 個
  portfolio: PortfolioPreview;
  strategyIdeas: StrategyIdea[];
  workflow: WorkflowItem[];
  blocked: BlockedItem[];
}

// ============================================================
// 2. Meta
// ============================================================

export interface Meta {
  operator: string;               // e.g. "IUF-01"
  mode: string;                   // e.g. "模擬模式 / 風控守門"
  market: string;                 // e.g. "盤面 / 真實資料"
  nowText: string;                // 顯示用,e.g. "2026/05/06 20:51:45 台北"
  formalOrder: FormalOrderState;
}

export interface FormalOrderState {
  state: "blocked";               // 永遠是 "blocked",直到 KGI 通道解鎖
  reason: string;                 // e.g. "KGI 正式下單仍鎖在 libCGCrypt.so 之外"
}

// ============================================================
// 3. Sources
// ============================================================

export interface SourceStatus {
  key: SourceKey;
  name: string;                   // 顯示名,e.g. "FinMind"
  short: string;                  // 短名,e.g. "FinMind"
  desc: string;                   // 一行描述
  status: SourceState;
  lastUpdateAt: IsoTimestamp | null;
  updated: string;                // 顯示用短字串,e.g. "05/06 20:51"。empty 時為 "—"
  note: string;                   // 顯示用註記,e.g. "今日資料" / "過期 13 天"
  stalenessMinutes: number | null;// 距現在分鐘數;empty 為 null
  days?: number | null;           // 過期天數,只在 stale 時有
  detail: string;                 // drawer 用詳細說明
  cta?: string | null;            // CTA label,e.g. "查看主題板 ›"
}

export interface SourceDetail extends SourceStatus {
  events: SourceEvent[];          // drawer 點開後的最近事件
}

export interface SourceEvent {
  at: IsoTimestamp;
  level: "info" | "warn" | "error";
  message: string;
}

// ============================================================
// 4. Quotes / Breadth / Heatmap (市場資料)
// ============================================================

export interface Quotes {
  /** 如果 status=empty,前端會顯示「以下為示意」徽章 */
  sourceState: SourceState;
  sourceLabel: string;            // e.g. "市場資料 · 無資料 / 顯示為示意"
  indices: Index[];               // 大盤指數
  flows: Flow[];                  // 三大法人
  stocks: Stock[];                // 個股,跑馬燈用,18 檔上下
  intradayTwii: number[];         // 60 點分時走勢,Hero IntradayChart 用
}

export interface Index {
  sym: string;                    // e.g. "TWII"
  name: string;                   // e.g. "加權指數"
  price: number;
  chg: number;                    // 漲跌點數
  pct: number;                    // 漲跌幅 %
}

export interface Flow {
  sym: string;                    // e.g. "外資"
  name: string;                   // e.g. "外資買賣超"
  price: number;                  // 買賣超金額
  unit: string;                   // e.g. "百萬"
}

export interface Stock {
  sym: string;                    // e.g. "2330"
  name: string;                   // e.g. "台積電"
  price: number;
  chg: number;
  pct: number;
}

export interface Breadth {
  up: number;                     // 上漲檔數
  flat: number;                   // 平盤檔數
  down: number;                   // 下跌檔數
  total: number;                  // 應該等於 up+flat+down
  asOf: IsoTimestamp;
}

export interface HeatmapResponse {
  sourceState: SourceState;       // empty 時前端會打標
  tiles: HeatmapTile[];           // 按市值降冪,前端只顯示前 23
}

export interface HeatmapTile {
  sym: string;
  name: string;
  pct: number;                    // 當日漲跌幅 %
  mcap: number;                   // 市值(億 NT$)
}

// ============================================================
// 5. Agenda
// ============================================================

export interface AgendaItem {
  time: string;                   // "HH:MM",e.g. "09:00"
  label: string;                  // e.g. "開盤" / "FinMind 抓批"
  state: AgendaState;
}

// ============================================================
// 6. FinMind 資料健康
// ============================================================

export interface FinmindHealth {
  sponsor: string;                // e.g. "Sponsor 999"
  /** ⚠️ 永遠不要回 token 字串,只回 boolean */
  tokenPresent: boolean;
  quotaTotal: number;             // 每小時 quota 上限
  quotaUsed: number;              // 已使用次數
  datasets: DatasetCounts;
  recentRequest: RecentRequest;
  requests: FinmindRequest[];     // 最近 5 筆,新到舊
}

export interface DatasetCounts {
  ok: number;
  downgraded: number;
  blocked: number;
}

export interface RecentRequest {
  name: string;                   // e.g. "TaiwanStockPriceAdj"
  at: IsoTimestamp;
  ok: boolean;
}

export interface FinmindRequest {
  name: string;
  at: IsoTimestamp;
  ms: number;                     // 反應時間
  ok: boolean;
  why: string | null;             // 失敗原因,ok=true 時為 null
}

// ============================================================
// 7. OpenAlice 每日簡報
// ============================================================

export interface OpenAliceStatus {
  runner: ServiceHealth;
  dispatcher: ServiceHealth;
  queue: QueueCounts;
  publishedToday: number;         // ⚠️ sourceTrail.complete=false 時必須為 0
  sourceTrail: SourceTrail;
  aiReview: AiReviewStatus;
  pipeline: PipelineStep[];       // 固定 5 段
  notice: string;                 // e.g. "簡報屬於 source trail,不是投資建議"
}

export interface ServiceHealth {
  state: "healthy" | "degraded" | "error";
  lastHeartbeat?: IsoTimestamp;   // runner 用
  lastScan?: IsoTimestamp;        // dispatcher 用
}

export interface QueueCounts {
  queued: number;
  running: number;
  review: number;
}

export interface SourceTrail {
  complete: boolean;
  missing: string[];              // 描述哪些上游缺,e.g. ["主題資料(過期 13 天)"]
}

export interface AiReviewStatus {
  state: "review" | "idle" | "running";
  waiting: number;
  note: string;
}

export interface PipelineStep {
  id: number;                     // 1-5,固定
  name: string;                   // 固定:資料拉取 / Source 拼接 / 草稿生成 / AI 審核 / 已發布
  state: StepState;
  note: string;
}

// ============================================================
// 8. Paper E2E 紙上交易流程
// ============================================================

export interface PaperStep {
  id: number;                     // 1-6,固定
  name: string;                   // 英文 step 名,e.g. "Preview"
  desc: string;                   // 中文描述
  state: StepState;
  count: number;                  // 該段筆數
  note: string;
}

// ============================================================
// 9. Portfolio
// ============================================================

export interface PortfolioPreview {
  cash: number;                   // NT$
  positions: number;              // 部位數
  /** 永遠是 "preview-only",不可連真實券商 */
  readiness: "preview-only";
  note: string;                   // e.g. "紙上預覽,不連真實券商"
}

// ============================================================
// 10. 策略候選
// ============================================================

export interface StrategyIdea {
  sym: string;                    // e.g. "3081.TW"
  name: string;
  /** 只能是研究立場,不可是「買進」「賣出」「目標價」 */
  stance: "中性" | "偏多研究" | "偏空研究";
  confidence: number;             // 0-100,研究信心,不是勝率不是預測
  gate: "ok" | "blocked";         // 訊號證據過期時應全部 blocked
  reason: string;                 // gate=blocked 時的原因
}

// ============================================================
// 11. Workflow & Blocked
// ============================================================

export interface WorkflowItem {
  id: string;                     // e.g. "w1"
  title: string;
  desc: string;
  cta: string;                    // 按鈕文字
  state: WorkflowState;
  href: string;                   // 路由
}

export interface BlockedItem {
  name: string;
  why: string;                    // 原因
  next: string;                   // 下一步
  icon: "news" | "signal" | "lab" | "lock";
}

// ============================================================
// 12. Status 對照表(顯示用,前端已有,後端可參考)
// ============================================================

export const STATUS_LABELS: Record<SourceState | StepState, { label: string; zh: string }> = {
  live:    { label: "LIVE",           zh: "正常" },
  empty:   { label: "EMPTY",          zh: "無資料" },
  stale:   { label: "STALE",          zh: "過期" },
  blocked: { label: "BLOCKED",        zh: "阻擋" },
  error:   { label: "ERROR",          zh: "錯誤" },
  review:  { label: "AI_REVIEWING",   zh: "AI 審核中" },
  ok:      { label: "OK",             zh: "通過" },
  warn:    { label: "WARN",           zh: "待補" },
  wait:    { label: "WAIT",           zh: "等待中" },
  idle:    { label: "IDLE",           zh: "閒置" },
};

```
