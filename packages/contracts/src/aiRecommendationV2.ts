import { z } from "zod";

// AI Recommendation v2 — Pure-AI independent judgment schema
// Parallel to v1 StockRecommendation. Does NOT depend on Athena fixture.
// Yang 2026-05-18 mandate: Brain ReAct sees full market data, recommends independently.
// v3 extension: 5-module Yang SOP — market state, 7 sub-scores, buckets, entry/TP/SL structure.

export const aiRecV2ActionSchema = z.enum([
  "今日首選",
  "可觀察布局（研究參考）",
  "等回檔",
  "高風險排除",
  "資料不足暫不推薦",
]);

// ── v3 Yang SOP additions ──────────────────────────────────────────────────────

export const aiRecMarketStateSchema = z.enum(["risk_off", "event", "trend", "range"]);
export type AiRecMarketState = z.infer<typeof aiRecMarketStateSchema>;

export const aiRecMarketScoresSchema = z.object({
  trend: z.number().int().min(0).max(5),    // 0-5: C>EMA20/EMA20>EMA60/EMA60>EMA120/ADX14>22/RS20>0
  range: z.number().int().min(0).max(3),    // 0-3: |C-EMA60|/EMA60<5% / ADX14<18 / BBWidth<40pct
  risk_off: z.number().int().min(0).max(6), // 0-6: VIX>25/VIX5d>30%/DXY60dZ>1/10Y20d>25bp/WTI10d>10%/TAIEX<EMA60
});
export type AiRecMarketScores = z.infer<typeof aiRecMarketScoresSchema>;

/** 7 sub-scores per Yang SOP — max points shown; total 100 */
export const aiRecSubScoresSchema = z.object({
  theme: z.number().min(0).max(20),         // 主題與產業鏈位置 /20
  revenue: z.number().min(0).max(15),       // 營收/財報驗證 /15
  institutional: z.number().min(0).max(15), // 法人/ETF /15
  margin: z.number().min(0).max(15),        // 融資/借券/擁擠度 /15
  rs: z.number().min(0).max(10),            // 相對強弱與量能 /10
  technical: z.number().min(0).max(20),     // 技術結構 /20
  valuation: z.number().min(0).max(5),      // 估值與事件風險 /5
});
export type AiRecSubScores = z.infer<typeof aiRecSubScoresSchema>;

export const aiRecBucketSchema = z.enum(["A+", "A", "B", "C"]);
export type AiRecBucket = z.infer<typeof aiRecBucketSchema>;

export const aiRecEntryZoneSchema = z.object({
  low: z.number().nullable(),
  high: z.number().nullable(),
  reason: z.string().optional(), // e.g. "OTE 0.618-0.705 回踩" or "突破後回測不破"
});

export const aiRecTpSchema = z.object({
  price: z.number().nullable(),
  reason: z.string().optional(), // e.g. "前波高 2024-11-18" or "月線上緣"
});

export const aiRecSlSchema = z.object({
  price: z.number().nullable(),
  atr_multiple: z.number().nullable(), // how many ATR14 from structure failure
});

export const aiRecPositionSizingSchema = z.object({
  nav_pct: z.number(),            // base NAV % (A+:0.8, A:0.6, B:0.4, C:0)
  market_multiplier: z.number(),  // trend/range/event/risk_off multiplier per SOP
});

/** Source trail entry — which tool was called for this ticker and what it returned */
export const aiRecSourceTrailEntrySchema = z.object({
  toolName: z.string(),
  ticker: z.string().optional(),
  round: z.number().int().min(1),
  dataFields: z.array(z.string()),  // e.g. ["lastPrice","rsi14","ma20","ma60"]
});
export type AiRecSourceTrailEntry = z.infer<typeof aiRecSourceTrailEntrySchema>;

/** Run-level score breakdown summary (aggregate across items) */
export const aiRecRunScoreBreakdownSchema = z.object({
  itemCount: z.number().int(),
  incompleteCount: z.number().int(),
  ratingDistribution: z.record(z.string(), z.number().int()),  // {"A+":1,"A":2,"B":1,"C":1}
  avgTotalScore: z.number().nullable(),
  topRating: z.enum(["A+", "A", "B", "C"]).nullable(),
});
export type AiRecRunScoreBreakdown = z.infer<typeof aiRecRunScoreBreakdownSchema>;

// ── Core schema (v2 backward-compat + v3 optional extensions) ─────────────────

export const aiStockRecommendationV2Schema = z.object({
  id: z.string(),
  ticker: z.string(),
  companyName: z.string(),
  date: z.string(), // YYYY-MM-DD TST
  action: aiRecV2ActionSchema,
  confidence: z.number().min(0).max(1),
  /** Entry price range derived from K-line support */
  entryPriceRange: z
    .object({
      low: z.number().nullable(),
      high: z.number().nullable(),
    })
    .nullable()
    .optional(),
  tp1: z.number().nullable().optional(),
  tp2: z.number().nullable().optional(),
  stopLoss: z.number().nullable().optional(),
  rationale: z.string(),
  /** Always true for v2 — distinguishes from v1 Athena-fixture recommendations */
  aiGenerated: z.literal(true),
  source: z.literal("brain_react_v2"),

  // ── v3 Yang SOP extensions (all optional for backward compat) ─────────────
  /** Market state badge from STEP 1 */
  marketState: aiRecMarketStateSchema.optional(),
  /** Raw market scores from STEP 1 */
  marketScores: aiRecMarketScoresSchema.optional(),
  /** 7 sub-scores from STEP 3 (total = sum of all, max 100) */
  subScores: aiRecSubScoresSchema.optional(),
  /** totalScore = sum of subScores */
  totalScore: z.number().min(0).max(100).optional(),
  /** A+/A/B/C bucket from STEP 4 */
  bucket: aiRecBucketSchema.optional(),
  /** STEP 5: entry zone with OTE / breakout-retest reason */
  entryZone: aiRecEntryZoneSchema.optional(),
  /** STEP 5: take profit 1 */
  tp1Structured: aiRecTpSchema.optional(),
  /** STEP 5: take profit 2 */
  tp2Structured: aiRecTpSchema.optional(),
  /** STEP 5: stop loss with ATR multiple */
  stopLossStructured: aiRecSlSchema.optional(),
  /** Risk/Reward ratio (TP1-entry)/(entry-SL) */
  r_ratio: z.number().optional(),
  /** Sizing per Yang SOP table */
  position_sizing: aiRecPositionSizingSchema.optional(),
  /** Transparent bull thesis bullets */
  why_buy: z.array(z.string()).optional(),
  /** Transparent bear / risk bullets */
  why_not_buy: z.array(z.string()).optional(),
  /** ≤80 char single-line plain-Chinese buy thesis (楊董 SOP "為什麼可以買") */
  whyBuyBrief: z.string().max(80).optional(),
  /** Tool call trail that produced data for this recommendation */
  sourceTrail: z.array(aiRecSourceTrailEntrySchema).optional(),
  /** True when any of the 7 sub-score axes is missing — this card was not fully scored */
  isIncomplete: z.boolean().optional(),
});

export type AiStockRecommendationV2 = z.infer<typeof aiStockRecommendationV2Schema>;

export const aiRecommendationV2RunSchema = z.object({
  runId: z.string(),
  status: z.enum([
    "complete",
    "failed",
    "budget_exceeded",
    "market_risk_off",
    "insufficient_tools",
    "synthesis_format_error",
  ]),
  generatedAt: z.string(),
  items: z.array(aiStockRecommendationV2Schema),
  reactTrace: z.array(z.unknown()),
  finalReportMarkdown: z.string(),
  totalCostUsd: z.number(),
  totalTokens: z.number(),
  dbRowId: z.string().nullable(),
  /** Run-level score breakdown summary (populated after items are parsed) */
  scoreBreakdown: aiRecRunScoreBreakdownSchema.optional(),
});

export type AiRecommendationV2Run = z.infer<typeof aiRecommendationV2RunSchema>;

export const aiRecommendationV2RefreshResponseSchema = z.object({
  ok: z.boolean(),
  runId: z.string(),
  trigger: z.string(),
  queuedAt: z.string(),
});
