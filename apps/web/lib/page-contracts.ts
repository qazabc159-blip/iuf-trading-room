/**
 * page-contracts.ts
 *
 * Adapter shim — pure TypeScript types only, zero runtime code.
 * Centralises all vendor-integration Props shapes so page.tsx files
 * don't each re-define their own.
 *
 * Contract docs: apps/web/docs/contracts/
 *
 * DO NOT add runtime logic here; keep this a types-only file.
 * DO NOT import backend-only types from packages/contracts directly —
 *   use the mapped label/tone variants below.
 */

// ── Shared tone / state primitives ──────────────────────────────────────────

export type Tone = "ok" | "warn" | "bad" | "dim";
export type DirectionTone = "up" | "down" | "dim";
export type PageState = "LIVE" | "EMPTY" | "BLOCKED";

// ── 01 Homepage (/page.tsx) ──────────────────────────────────────────────────

export type HeroKpiProps = {
  todayBriefState: "已發布" | "待審核" | "尚無" | "暫停";
  marketStateLabel: "多頭偏好" | "空頭偏好" | "均衡觀望";
  signalCount: number;
  alertCount: number;
  paperHealthLabel: "正常" | "守住" | "需處理";
  kgiQuoteLabel: "即時" | "略舊" | "等待";
};

export type BriefCardProps = {
  id: string;
  date: string;
  title: string;
  marketStateLabel: string;
  marketStateTone: Tone;
  ageLabel: string;
  sectionCount: number;
  href: string;
};

export type IntelCardProps = {
  ticker: string;
  companyName: string;
  headline: string;
  publishedAt: string;
  kind: "material" | "financial" | "general";
  kindLabel: "重大公告" | "財務公告" | "一般公告";
};

export type StrategyKpiProps = {
  latestRunAt: string | null;
  totalIdeas: number;
  allowCount: number;
  reviewCount: number;
  blockCount: number;
};

export type AlertStripProps = {
  todayCount: number;
  unreadCount: number;
  severity: "info" | "warning" | "critical" | "none";
};

// ── 02 Market Intel (/market-intel) ─────────────────────────────────────────

export type DataSourceBadgeProps = {
  finmindLabel: "正常" | "較舊" | "異常" | "未知";
  lastSyncAt: string | null;
};

export type AnnouncementCardProps = {
  ticker: string;
  companyName: string;
  headline: string;
  publishedAt: string;
  kind: "material" | "financial" | "general";
  kindLabel: string;
  body?: string;
};

export type NewsItemProps = {
  headline: string;
  sourceLabel: string;
  publishedAt: string;
  score: number | null;
};

// ── 03/04 Briefs (/briefs, /briefs/[id]) ────────────────────────────────────

export type BriefSearchBarProps = {
  query: string;
  fromDate: string | null;
  toDate: string | null;
  onChange: (query: string) => void;
  onFromDate: (date: string | null) => void;
  onToDate: (date: string | null) => void;
  onClear: () => void;
  isLoading: boolean;
};

export type BriefSearchResultProps = {
  id: string;
  title: string;
  snippet: string;
  date: string;
  href: string;
};

export type BriefEngineStatusProps = {
  label: "運行中" | "延遲" | "異常" | "等待";
  queueCount: number;
  lastGenAt: string | null;
};

export type BriefHeroProps = {
  date: string;
  title: string;
  marketStateLabel: string;
  marketStateTone: Tone;
  publishedAt: string;
  isUnpublished: boolean;
};

export type BriefKpiBarProps = {
  statusLabel: string;
  statusTone: Tone;
  sectionCount: number;
  adversarialLabel: string;
  adversarialTone: Tone;
  factCheckLabel: string;
  factCheckTone: Tone;
};

export type BriefSectionCardProps = {
  heading: string;
  body: string;
  sourceLabel: string | null;
};

// ── 05 Alerts (/alerts) ──────────────────────────────────────────────────────

export type AlertsKpiBarProps = {
  todayCount: number;
  unreadCount: number;
  engineStatusLabel: "運行中" | "等待" | "異常";
  engineStatusTone: Tone;
  lastTickLabel: string;
};

export type AlertCardProps = {
  id: string;
  ruleLabel: string;
  severityLabel: "資訊" | "注意" | "重要";
  severityTone: Tone;
  ticker: string | null;
  triggeredAtLabel: string;
  acknowledged: boolean;
  payloadSummary: string | null;
};

export type RuleCatalogueRowProps = {
  label: string;
  desc: string;
  dataSourceLabel: string;
  severityLabel: string;
  lastFiredLabel: string;
};

// ── 06 Signals (/signals) ───────────────────────────────────────────────────

export type SignalsKpiBarProps = {
  totalCount: number;
  themeCount: number;
  companyCount: number;
  statusLabel: string;
  statusTone: Tone;
};

export type SignalCardProps = {
  id: string;
  headline: string;
  themeLabel: string;
  companyTicker: string | null;
  companyName: string | null;
  directionLabel: "偏多" | "偏空" | "中性";
  directionTone: DirectionTone;
  confidence: number | null;
  confidenceLabel: string | null;
  categoryLabel: string;
  createdAtLabel: string;
};

// ── 07 Portfolio (/portfolio) ────────────────────────────────────────────────

export type PortfolioKpiBarProps = {
  positionCount: number;
  totalMarketValueLabel: string;
  totalPnlLabel: string;
  totalPnlTone: Tone;
  fillCount: number;
  capitalUsedPct: number;
  systemStatusLabel: string;
  systemStatusTone: Tone;
};

export type PositionRowProps = {
  symbol: string;
  quantity: number;
  quantityUnitLabel: "張" | "股";
  avgCostLabel: string;
  marketValueLabel: string;
  unrealizedPnlLabel: string;
  unrealizedPnlTone: Tone;
  href: string;
};

export type FillRowProps = {
  symbol: string;
  sideLabel: "買進" | "賣出";
  sideTone: DirectionTone;
  quantity: number;
  quantityUnitLabel: "張" | "股";
  priceLabel: string;
  fillTimeLabel: string;
};

// ── 08 Ideas (/ideas) ───────────────────────────────────────────────────────

export type IdeasKpiBarProps = {
  statusLabel: string;
  statusTone: Tone;
  totalCount: number;
  allowCount: number;
  reviewCount: number;
  blockCount: number;
  strategyReadyCount: number;
  generatedAtLabel: string;
};

export type IdeaCardProps = {
  id: string;
  ticker: string;
  companyName: string;
  themeLabel: string | null;
  directionLabel: "偏多" | "偏空" | "中性";
  directionTone: DirectionTone;
  decisionLabel: "建議進場" | "待審核" | "不建議進場";
  decisionTone: Tone;
  qualityLabel: "策略就緒" | "僅供參考" | "資料不足";
  qualityTone: Tone;
  score: number | null;
  confidence: number | null;
  rationale: string;
  href: string;
};

// ── 09 Runs (/runs, /runs/[id]) ──────────────────────────────────────────────

export type RunCardProps = {
  id: string;
  decisionModeLabel: string;
  directionLabel: string;
  directionTone: DirectionTone;
  qualityLabel: string;
  generatedAtLabel: string;
  outputCount: number;
  href: string;
};

export type RunDetailKpiBarProps = {
  statusLabel: string;
  statusTone: Tone;
  totalCandidates: number;
  observableCount: number;
  pendingCount: number;
  notInFlowCount: number;
  strategyUsable: boolean;
};

export type RunOutputItemProps = {
  ticker: string;
  companyName: string;
  decisionLabel: string;
  decisionTone: Tone;
  qualityLabel: string;
  rationale: string;
  score: number | null;
  href: string;
};

// ── 10 Lab (/lab, /lab/three-strategy/*) ─────────────────────────────────────

export type StrategyHeroCardProps = {
  displayName: string;
  stageLabel: string;
  stageTone: "amber" | "blue" | "dim" | "violet";
  badgeColor: "amber" | "blue" | "violet";
  isRetired: boolean;
  caveatSummary: string;
  equityCurvePoints: number[] | null;
  isPendingChart: boolean;
  kpiLabel: string;
  href: string | null;
};

export type StrategyKpiGridProps = {
  sharpeLabel: string;
  maxDrawdownLabel: string;
  winRateLabel: string;
  sampleTradesLabel: string;
  yearReturnLabel: string;
  robustnessLabel: string;
  capacityWarning: string | null;
};

// ── 11 Companies (/companies, /companies/[symbol]) ───────────────────────────

export type CompaniesKpiBarProps = {
  totalCount: number;
  coreCount: number;
  directCount: number;
  indirectCount: number;
  statusLabel: string;
  statusTone: Tone;
};

export type CompanyRowProps = {
  ticker: string;
  name: string;
  chainPositionLabel: string;
  beneficiaryTierLabel: "核心" | "直接" | "間接" | "觀察";
  beneficiaryTierTone: Tone;
  href: string;
};

export type CompanyHeroBarProps = {
  symbol: string;
  companyName: string;
  lastPrice: number | null;
  priceChangeLabel: string;
  priceTone: DirectionTone;
  volume: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  quoteStateLabel: "即時" | "略舊" | "等待";
  quoteStateTone: "live" | "stale" | "waiting";
  asOfLabel: string;
};

export type BidAskPanelProps = {
  state: "live" | "blocked";
  blockedReason?: string;
  askLevels: Array<{ price: number; volume: number }>;
  bidLevels: Array<{ price: number; volume: number }>;
  midPrice: number | null;
};

export type TickStreamPanelProps = {
  state: "live" | "blocked";
  ticks: Array<{
    time: string;
    price: number;
    volume: number;
    directionLabel: "買" | "賣" | "平";
    directionTone: DirectionTone;
  }>;
};

export type InstitutionalKpiProps = {
  state: "live" | "blocked" | "empty";
  dateLabel: string;
  foreignNetBuyLabel: string;
  foreignTone: Tone;
  investTrustLabel: string;
  dealerLabel: string;
  totalNetBuyLabel: string;
};

export type MarginShortKpiProps = {
  state: "live" | "blocked" | "empty";
  dateLabel: string;
  marginBalanceLabel: string;
  marginChangeTone: Tone;
  shortBalanceLabel: string;
  shortChangeTone: Tone;
};
