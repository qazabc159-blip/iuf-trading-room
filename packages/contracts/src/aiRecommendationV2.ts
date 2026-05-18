import { z } from "zod";

// AI Recommendation v2 — Pure-AI independent judgment schema
// Parallel to v1 StockRecommendation. Does NOT depend on Athena fixture.
// Yang 2026-05-18 mandate: Brain ReAct sees full market data, recommends independently.

export const aiRecV2ActionSchema = z.enum([
  "今日首選",
  "可觀察布局（研究參考）",
  "等回檔",
  "高風險排除",
  "資料不足暫不推薦",
]);

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
});

export type AiStockRecommendationV2 = z.infer<typeof aiStockRecommendationV2Schema>;

export const aiRecommendationV2RunSchema = z.object({
  runId: z.string(),
  status: z.enum(["complete", "failed", "budget_exceeded"]),
  generatedAt: z.string(),
  items: z.array(aiStockRecommendationV2Schema),
  reactTrace: z.array(z.unknown()),
  finalReportMarkdown: z.string(),
  totalCostUsd: z.number(),
  totalTokens: z.number(),
  dbRowId: z.string().nullable(),
});

export type AiRecommendationV2Run = z.infer<typeof aiRecommendationV2RunSchema>;

export const aiRecommendationV2RefreshResponseSchema = z.object({
  ok: z.boolean(),
  runId: z.string(),
  trigger: z.string(),
  queuedAt: z.string(),
});
