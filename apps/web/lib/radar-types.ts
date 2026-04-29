/**
 * IUF · TR — domain types (placeholder schema for backend handoff)
 *
 * These are the shapes the UI consumes. Backend MUST return data matching these
 * shapes (or transform server-side before serving). Mock implementations live in
 * `src/lib/mocks/`. When backend is ready, replace `src/lib/api.ts` with real
 * fetch calls — the components don't need to change.
 */

/* ─── Themes ─────────────────────────────────────────────────────────── */
export type Momentum = "ACCEL" | "STEADY" | "DECEL";
export type LockState = "LOCKED" | "TRACK" | "WATCH" | "STALE";

export interface Theme {
  rank: number;
  code: string;          // e.g. "AI-PWR"
  name: string;          // zh-TW
  short: string;         // en slug
  heat: number;          // 0..100
  dHeat: number;         // d7 delta
  members: number;       // company count
  momentum: Momentum;
  lockState: LockState;
  pulse: number[];       // d7 sparkline, length 7
}

/* ─── Companies ──────────────────────────────────────────────────────── */
export interface Company {
  symbol: string;        // TWSE code, e.g. "2330"
  name: string;          // zh-TW
  marketCapBn: number;   // TWD billion
  themes: string[];      // theme codes
  score: number;         // 0..1
  momentum: Momentum;
  intradayChgPct: number;
  fiiNetBn5d: number;    // foreign-investor net 5-day, TWD billion
  listing: "TWSE" | "TPEX";
}

/* ─── Ideas ──────────────────────────────────────────────────────────── */
export type Side = "LONG" | "SHORT" | "TRIM" | "EXIT";
export type Quality = "HIGH" | "MED" | "LOW";

export interface Idea {
  id: string;            // "ID-1142"
  symbol: string;
  side: Side;
  quality: Quality;
  confidence: number;    // 0..1
  score: number;         // 0..1
  themeCode: string;
  rationale: string;     // zh-TW, ≤ 280 chars
  emittedAt: string;     // ISO 8601
  expiresAt: string;     // ISO 8601
  runId: string;
}

/* ─── Runs ───────────────────────────────────────────────────────────── */
export type RunSource = "auto·post-close" | "auto·pre-open" | "manual";
export type RunState = "ACTIVE" | "ARCHIVED" | "FAILED";

export interface Run {
  id: string;            // "RUN·2026-W17·218"
  startedAt: string;
  source: RunSource;
  ideasEmitted: number;
  highQualityCount: number;
  avgConfidence: number;
  durationMs: number;
  strategyVersion: string;
  state: RunState;
  /** Optional snapshot of the query that produced this run. Mocked locally; backend may omit. */
  query?: RunQuerySnapshot;
}

/** Mirrors the Strategy Console knobs at the moment the run was triggered. */
export interface RunQuerySnapshot {
  mode: "post-close" | "pre-open" | "manual";
  sort: "score" | "confidence" | "fii" | "momentum";
  limit: number;                        // max ideas to emit
  signalDays: number;                   // lookback window
  qualityFilter: ("HIGH"|"MED"|"LOW")[];
  decisionFilter: ("LONG"|"SHORT"|"TRIM"|"EXIT")[];
  market: ("TWSE"|"TPEX")[];
  symbol: string | null;                // null = all
  theme:  string | null;                // null = all
}

/* ─── Signals ────────────────────────────────────────────────────────── */
export type SignalChannel = "MOM" | "FII" | "KW" | "VOL" | "THM" | "MAN";
export type SignalState = "EMITTED" | "MUTED";

export interface Signal {
  id: string;
  emittedAt: string;
  code: string;          // "S·MOM·ACL"
  channel: SignalChannel;
  symbol: string | null;
  themeCode: string | null;
  quality: Quality;
  state: SignalState;
  trigger: string;       // human-readable
}

/* ─── Portfolio · Execution layer ────────────────────────────────────── */
export type KillMode = "ARMED" | "SAFE" | "PEEK" | "FROZEN";

export interface Quote {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  state: "LIVE" | "CLOSE" | "HALT";
  asOf: string;          // ISO 8601
}

export interface Position {
  symbol: string;
  name: string;
  qty: number;
  avgPx: number;
  lastPx: number;
  changePct: number;
  pnlTwd: number;
  pctNav: number;
}

export type OrderSide   = "BUY" | "SELL" | "TRIM";
export type OrderType   = "LMT" | "MKT" | "STOP";
export type OrderTif    = "ROD" | "IOC" | "FOK";
export type OrderVenue  = "TWSE" | "TPEX" | "DARK";

export interface OrderTicket {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  tif: OrderTif;
  venue: OrderVenue;
  limitPx: number | null;
  qty: number;
  fromIdeaId?: string;
}

export type RiskCheckResult = "PASS" | "WARN" | "BLOCK";
/** Which layer in the override stack this limit comes from. */
export type RiskLayer = "ACCT" | "STRAT" | "SYM" | "SESS";

export interface RiskLimit {
  rule: string;          // "MAX·SYMBOL %"
  limit: string;         // human, e.g. " 8.0%"
  current: string;       // human
  result: RiskCheckResult;
  layer?: RiskLayer;     // optional — for guardrail list rows
}

/** One guard evaluated during preview; UI shows them as a stacked checklist. */
export interface GuardResult {
  rule: string;          // "MAX·NOTIONAL"
  layer: RiskLayer;
  limit: string;         // human "  500,000 TWD"
  observed: string;      // human " 184,000 TWD"
  result: RiskCheckResult;
  reason?: string;       // when WARN/BLOCK — short zh-TW
}

/** What `POST /api/orders/preview` returns. */
export interface OrderPreview {
  pass: boolean;                 // overall — false if any BLOCK
  guards: GuardResult[];
  effectiveLimits: GuardResult[]; // hit limits, layer-tagged
  sizing: SizingBreakdown;
}

/** Why qty came out the way it did. UI shows as a small calc card. */
export interface SizingBreakdown {
  sizingMode: "fixed" | "risk-pct" | "kelly";
  equity: number;             // TWD
  riskPerTrade: number;       // 0..1
  lotSize: number;            // TWSE ≥ 1000
  capByMaxPositionPct: number;// post-cap qty
  finalQty: number;
  notes?: string;             // zh-TW free text
}

/** Acknowledgement of submitted order. */
export interface OrderAck {
  orderId: string;
  clientOrderId: string;
  status: "ACCEPTED" | "QUEUED" | "REJECTED";
  rejectReason?: string;
  acceptedAt: string;          // ISO
}

/* ─── Execution event stream ─────────────────────────────────────────── */
export type ExecutionEventKind =
  | "order_placed"
  | "order_filled"
  | "order_cancelled"
  | "order_rejected"
  | "risk_blocked";

export interface ExecutionEvent {
  id: string;
  kind: ExecutionEventKind;
  ts: string;                 // ISO 8601
  orderId: string | null;
  clientOrderId: string | null;
  symbol: string;
  side: OrderSide | null;
  qty: number | null;
  price: number | null;
  fee: number | null;
  tax: number | null;
  raw: Record<string, unknown>; // raw broker payload (collapsible)
}

/* ─── Risk-layer overrides (strategy / symbol tabs) ──────────────────── */
/** A null field means "inherit from layer above". */
export interface BaseRiskOverride {
  id: string;
  scopeKey: string;           // strategyId or symbol
  maxPerTrade: number | null;
  dailyPnl: number | null;
  singlePosPct: number | null;
  themePosPct: number | null;
  grossPosPct: number | null;
  updatedAt: string;
  note?: string;
}
export interface StrategyRiskLimit extends BaseRiskOverride {
  scope: "strategy";
}
export interface SymbolRiskLimit extends BaseRiskOverride {
  scope: "symbol";
}

/* ─── Chart abstraction ──────────────────────────────────────────────── */
export type ChartInterval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk";
export type ChartTimezone = "Asia/Taipei" | "America/New_York" | "Europe/London" | "Asia/Tokyo";

export type ChartStreamState = "idle" | "connecting" | "live" | "stale" | "error";

export interface ChartTick {
  symbol: string;
  price: number;
  ts: string;            // ISO 8601
}

export interface ChartProps {
  symbol: string;        // TWSE code
  interval?: ChartInterval;
  timezone?: ChartTimezone;
  height?: number;
  /** when CHART_PROVIDER=kgi-lightweight, used to subscribe to KGI quote stream */
  liveStreamUrl?: string;
  /* ─── lifecycle (TV widget can no-op these; KGI provider implements) ── */
  onReady?: () => void;
  onTickStream?: (t: ChartTick) => void;
  onError?: (e: Error) => void;
  onIntervalChange?: (interval: ChartInterval) => void;
  streamState?: ChartStreamState;
}

/* ─── Idea → Order handoff ──────────────────────────────────────────── */
/** Stashed in sessionStorage when user clicks "帶去下單台" on an idea row.
   Portfolio page reads this on mount to prefill OrderTicket. */
export interface IdeaHandoff {
  ideaId: string;
  symbol: string;
  side: OrderSide;             // mapped from Idea.side: LONG→BUY, TRIM→TRIM, EXIT→SELL, SHORT→SELL
  rationale: string;
  themeCode: string;
  emittedAt: string;
}
export const IDEA_HANDOFF_KEY = "iuf:idea-handoff:v1";

/* ─── Ops · System health & worker queue ─────────────────────────────── */
export type ApiHealthState = "GREEN" | "AMBER" | "RED";

export interface ApiHealth {
  endpoint: string;            // "/api/themes"
  method: "GET" | "POST";
  state: ApiHealthState;
  lastSeen: string;            // ISO
  latencyMs: number;
  errorRate24h: number;        // 0..1
}

export interface DataSourceDetail {
  state: "MOCK" | "LIVE" | "OFFLINE";
  baseUrl: string;             // "" if mock
  lastFetchAt: string | null;  // ISO
  lastError: string | null;
  offlineCount24h: number;
  fallbackCount24h: number;
}

export type WorkerJobState = "QUEUED" | "RUNNING" | "DONE" | "FAILED";
export interface WorkerJob {
  jobId: string;
  kind: string;                 // "openalice·post-close" / "fii·sync" etc
  state: WorkerJobState;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  payload?: Record<string, unknown>;
  errorMsg?: string;
}

export interface BuildInfo {
  version: string;              // "0.5.0"
  commit: string;               // short SHA
  branch: string;
  deployedAt: string;
  nodeEnv: "development" | "production" | "test";
}

export interface OpsSystem {
  apis: ApiHealth[];
  dataSource: DataSourceDetail;
  jobs: WorkerJob[];
  build: BuildInfo;
}

/* ─── Ops · Activity log ──────────────────────────────────────────────── */
export type ActivitySource = "api" | "worker" | "scheduler" | "manual" | "ext";
export type ActivitySeverity = "INFO" | "WARN" | "ERROR";

export interface ActivityEvent {
  id: string;
  ts: string;                   // ISO
  source: ActivitySource;
  severity: ActivitySeverity;
  event: string;                // short slug "fii.sync.completed"
  summary: string;              // human, ≤ 140
  payload?: Record<string, unknown>;
}

/* ─── Ops · Audit log ─────────────────────────────────────────────────── */
export type AuditAction = "WRITE" | "READ" | "DELETE";

export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;                // "IUF·01" / "system" / "scheduler"
  action: AuditAction;
  entityType: string;           // "idea" / "order" / "risk_limit" / "kill_mode"
  entityId: string;
  diff?: Record<string, unknown>;
  ip?: string;
}

export interface AuditSummary {
  todayTotal: number;
  byAction: Record<AuditAction, number>;
  byActor: { actor: string; count: number }[];
  byEntity: { entityType: string; count: number }[];
}

/* ─── Plans · Brief / Review / Weekly ─────────────────────────────────── */
export interface MarketState {
  state: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
  countdownSec: number;         // sec until next session change
  futuresNight: { last: number; chgPct: number };
  usMarket:     { index: string; last: number; chgPct: number; closeTs: string };
  events: { ts: string; label: string; weight: "HIGH"|"MED"|"LOW" }[];
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  themeCode: string | null;
  note?: string;
}

export interface BriefBundle {
  date: string;                 // YYYY-MM-DD
  market: MarketState;
  topThemes: Theme[];           // 6
  ideasOpen: Idea[];
  watchlist: WatchlistItem[];
  riskTodayLimits: RiskLimit[];
}

export interface ReviewBundle {
  date: string;
  pnl: { realized: number; unrealized: number; navStart: number; navEnd: number };
  trades: ExecutionEvent[];     // kind=order_filled, today
  ideaHitRate: { emitted: number; filled: number; pct: number };
  signalsSummary: { channel: SignalChannel; count: number }[];
}

export interface WeeklyPlan {
  weekNo: string;               // "2026-W17"
  summary: { trades: number; cumPnl: number; themeWinRate: number; bestTheme: string };
  themeRotation: { code: string; heatStart: number; heatEnd: number; delta: number }[];
  strategyTweaks: { strategyId: string; change: string; ts: string }[];
}

/* ─── Operator / session ─────────────────────────────────────────────── */
export interface SessionMeta {
  operator: string;
  sessionDate: string;   // YYYY-MM-DD
  weekNo: string;        // "W17"
  marketState: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
  killMode: KillMode;
  runId: string;         // current/last RUN
}
