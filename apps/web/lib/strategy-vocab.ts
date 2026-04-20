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
