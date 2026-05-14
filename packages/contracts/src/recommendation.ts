import { z } from "zod";

// IUF Recommendation Orchestrator v1 — schema contract
// Per spec: 楊董 2026-05-14

export const recommendationActionSchema = z.enum([
  "今日首選",
  "可布局",
  "等回檔",
  "高風險排除",
  "資料不足暫不推薦"
]);

export const recommendationDirectionSchema = z.enum(["偏多", "偏空", "中性"]);

export const recommendationTimeHorizonSchema = z.enum(["當沖/隔日", "1-2週", "波段"]);

export const recommendationGateStatusSchema = z.enum(["PASS", "WATCH", "FAIL"]);

export const recommendationDataQualityStatusSchema = z.enum(["OK", "STALE", "MISSING"]);

export const recommendationQuantDataQualitySchema = z.enum(["OK", "WEAK", "MISSING"]);

export const recommendationPositionSuggestionSchema = z.enum(["小倉", "中倉", "禁止追高"]);

export const stockRecommendationSchema = z.object({
  recommendationId: z.string(),
  date: z.string(), // ISO date YYYY-MM-DD
  ticker: z.string(),
  companyName: z.string(),
  rank: z.number(),
  action: recommendationActionSchema,
  direction: recommendationDirectionSchema,
  timeHorizon: recommendationTimeHorizonSchema,
  confidence: z.number().min(0).max(1),
  totalScore: z.number().min(0).max(100),
  quant: z.object({
    score: z.number().min(0).max(100),
    strategySource: z.string(),
    gateStatus: recommendationGateStatusSchema,
    reason: z.array(z.string()),
  }),
  entryZone: z.object({
    primary: z.string(),
    secondary: z.string().optional(),
    reason: z.string(),
  }),
  invalidation: z.object({
    price: z.number().nullable(),
    rule: z.string(),
  }),
  targets: z.array(z.object({
    label: z.enum(["TP1", "TP2", "延伸"]),
    price: z.number().nullable(),
    reason: z.string(),
  })),
  positionSizing: z.object({
    suggestion: recommendationPositionSuggestionSchema,
    maxRiskPct: z.number(),
  }),
  reasons: z.object({
    technical: z.array(z.string()),
    chip: z.array(z.string()),
    news: z.array(z.string()),
    theme: z.array(z.string()),
    quant: z.array(z.string()),
    macro: z.array(z.string()),
  }),
  risks: z.array(z.string()),
  dataQuality: z.object({
    quote: recommendationDataQualityStatusSchema,
    kbar: recommendationDataQualityStatusSchema,
    chip: recommendationDataQualityStatusSchema,
    news: recommendationDataQualityStatusSchema,
    quant: recommendationQuantDataQualitySchema,
    confidencePenalty: z.number(),
  }),
  sourceTrail: z.array(z.object({
    type: z.string(),
    source: z.string(),
    timestamp: z.string(),
  })),
  generatedBy: z.literal("iuf_recommendation_orchestrator_v1"),
  generatedAt: z.string(),
});

export type StockRecommendation = z.infer<typeof stockRecommendationSchema>;

export const recommendationFeedbackBodySchema = z.object({
  reaction: z.enum(["like", "dislike", "skip", "acted"]),
  note: z.string().max(500).optional(),
});

export type RecommendationFeedback = z.infer<typeof recommendationFeedbackBodySchema>;

export const recommendationListResponseSchema = z.object({
  date: z.string(),
  generatedAt: z.string(),
  count: z.number(),
  items: z.array(stockRecommendationSchema),
});
