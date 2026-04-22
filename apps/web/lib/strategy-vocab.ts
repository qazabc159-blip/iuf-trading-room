import type {
  StrategyIdea,
  StrategyIdeaDirection,
  StrategyIdeaMarketDecision,
  StrategyIdeasDecisionMode,
  StrategyIdeasSort
} from "@iuf-trading-room/contracts";

// Single source of truth for the Chinese labels + badge class names used
// across /ideas, /runs, and the /portfolio strategy-context-card. Keeping
// them colocated means "看多" in one view can't drift to "多方" in another.
export const DIRECTION_LABEL: Record<StrategyIdeaDirection, string> = {
  bullish: "看多",
  bearish: "看空",
  neutral: "中性"
};

export const DIRECTION_BADGE: Record<StrategyIdeaDirection, string> = {
  bullish: "badge-green",
  bearish: "badge-red",
  neutral: "badge-blue"
};

export const DECISION_LABEL: Record<StrategyIdeaMarketDecision, string> = {
  allow: "允許送單",
  review: "需審視",
  block: "封鎖"
};

export const DECISION_BADGE: Record<StrategyIdeaMarketDecision, string> = {
  allow: "badge-green",
  review: "badge-yellow",
  block: "badge-red"
};

export type QualityGrade = StrategyIdea["quality"]["grade"];

export const QUALITY_LABEL: Record<QualityGrade, string> = {
  strategy_ready: "可策略執行",
  reference_only: "僅供參考",
  insufficient: "資料不足"
};

export const QUALITY_BADGE: Record<QualityGrade, string> = {
  strategy_ready: "badge-green",
  reference_only: "badge-yellow",
  insufficient: "badge-red"
};

export const MODE_LABEL: Record<StrategyIdeasDecisionMode, string> = {
  strategy: "策略篩選",
  paper: "紙上交易",
  execution: "真倉執行"
};

export const SORT_LABEL: Record<StrategyIdeasSort, string> = {
  score: "推薦分數",
  signal_strength: "訊號強度",
  signal_recency: "訊號時效",
  theme_rank: "主題熱度",
  symbol: "代號"
};

// Strategy engine / market-data / broker 產出的 primaryReason enum → 繁中。
// 未命中的字串原樣顯示（新 enum 出現時不會爆，但提示 UI 需要補 mapping）。
const REASON_LABEL_MAP: Record<string, string> = {
  // market-data history quality
  history_strategy_ready: "歷史資料就緒",
  missing_history: "缺少歷史資料",
  stale_history: "歷史資料過舊",
  insufficient_points: "歷史資料點數不足",
  synthetic_history: "歷史資料為合成填補",
  partial_time_window: "時間視窗不完整",

  // market-data bar-series quality
  bar_series_strategy_ready: "K 線資料就緒",
  missing_bars: "缺少 K 線資料",
  stale_bars: "K 線資料過舊",
  insufficient_bars: "K 線資料筆數不足",
  synthetic_bars: "K 線為合成填補",
  approximate_bars: "K 線為近似值",

  // market-data decision (broker 側)
  no_quote: "無即時報價",
  missing_quote: "缺報價",
  quote_not_paper_safe: "報價未達紙上交易門檻",
  no_reference_price: "無參考價",
  missing_market_decision: "無市場決策輸出",

  // rationale
  recent_signals_present: "近期有訊號支持",
  no_recent_signals: "近期無訊號",
  theme_rank_support: "主題熱度支撐",
  composite_score: "綜合分數推薦",

  // summary fallback
  no_quality_reason: "品質未分類"
};

export function reasonLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return REASON_LABEL_MAP[raw] ?? raw;
}
