import { z } from "zod";

import { beneficiaryTierSchema } from "./company.js";
import { companyRelationTypeSchema } from "./companyGraph.js";

export const themeGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["theme_company", "company", "external_label"]),
  companyId: z.string().uuid().nullable(),
  label: z.string().min(1).max(160),
  ticker: z.string().min(1).max(40).optional(),
  market: z.string().min(1).max(40).optional(),
  beneficiaryTier: beneficiaryTierSchema.optional(),
  relationCount: z.number().int().min(0).default(0),
  keywordCount: z.number().int().min(0).default(0)
});

export const themeGraphEdgeSchema = z.object({
  id: z.string().min(1),
  relationId: z.string().uuid(),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  direction: z.enum(["internal", "outbound", "inbound"]),
  relationType: companyRelationTypeSchema,
  confidence: z.number().min(0).max(1),
  sourcePath: z.string().min(1).max(400)
});

export const themeGraphKeywordRollupSchema = z.object({
  label: z.string().min(1).max(120),
  count: z.number().int().min(0),
  companyCount: z.number().int().min(0)
});

export const themeGraphSummarySchema = z.object({
  themeCompanyCount: z.number().int().min(0),
  relatedCompanyCount: z.number().int().min(0),
  internalEdges: z.number().int().min(0),
  outboundEdges: z.number().int().min(0),
  inboundEdges: z.number().int().min(0),
  externalLabels: z.number().int().min(0),
  displayedEdges: z.number().int().min(0),
  totalMatchingEdges: z.number().int().min(0),
  keywordCount: z.number().int().min(0)
});

export const themeGraphStatsThemeSchema = z.object({
  themeId: z.string().uuid(),
  name: z.string().min(1).max(120),
  marketState: z.string().min(1).max(40),
  lifecycle: z.string().min(1).max(40),
  priority: z.number().int().min(1).max(5),
  themeCompanyCount: z.number().int().min(0),
  relatedCompanyCount: z.number().int().min(0),
  totalEdges: z.number().int().min(0),
  keywordCount: z.number().int().min(0),
  topKeywords: z.array(themeGraphKeywordRollupSchema).max(5)
});

export const themeGraphStatsViewSchema = z.object({
  generatedAt: z.string(),
  themeCount: z.number().int().min(0),
  connectedThemeCount: z.number().int().min(0),
  totalThemeCompanies: z.number().int().min(0),
  totalRelatedCompanies: z.number().int().min(0),
  totalEdges: z.number().int().min(0),
  totalKeywords: z.number().int().min(0),
  topThemes: z.array(themeGraphStatsThemeSchema)
});

export const themeGraphRankingBreakdownSchema = z.object({
  conviction: z.number().int().min(0).max(40),
  connectivity: z.number().int().min(0).max(30),
  leverage: z.number().int().min(0).max(20),
  keywordRichness: z.number().int().min(0).max(10)
});

export const themeGraphRankingResultSchema = z.object({
  themeId: z.string().uuid(),
  name: z.string().min(1).max(120),
  marketState: z.string().min(1).max(40),
  lifecycle: z.string().min(1).max(40),
  priority: z.number().int().min(1).max(5),
  score: z.number().int().min(0).max(100),
  averageExposure: z.number().min(1).max(5),
  breakdown: themeGraphRankingBreakdownSchema,
  signals: z.array(z.string().min(1).max(120)).max(8),
  summary: themeGraphStatsThemeSchema
});

export const themeGraphRankingViewSchema = z.object({
  generatedAt: z.string(),
  total: z.number().int().min(0),
  results: z.array(themeGraphRankingResultSchema)
});

export const themeGraphSearchResultSchema = z.object({
  themeId: z.string().uuid(),
  name: z.string().min(1).max(120),
  marketState: z.string().min(1).max(40),
  lifecycle: z.string().min(1).max(40),
  priority: z.number().int().min(1).max(5),
  score: z.number().int().min(0),
  matchReasons: z.array(z.string().min(1).max(80)).max(8),
  matchedCompanies: z.number().int().min(0),
  matchedKeywords: z.number().int().min(0),
  summary: themeGraphStatsThemeSchema
});

export const themeGraphSearchViewSchema = z.object({
  generatedAt: z.string(),
  query: z.string(),
  total: z.number().int().min(0),
  results: z.array(themeGraphSearchResultSchema)
});

export const themeGraphViewSchema = z.object({
  themeId: z.string().uuid(),
  generatedAt: z.string(),
  nodes: z.array(themeGraphNodeSchema),
  edges: z.array(themeGraphEdgeSchema),
  topKeywords: z.array(themeGraphKeywordRollupSchema),
  summary: themeGraphSummarySchema
});

export type ThemeGraphNode = z.infer<typeof themeGraphNodeSchema>;
export type ThemeGraphEdge = z.infer<typeof themeGraphEdgeSchema>;
export type ThemeGraphKeywordRollup = z.infer<typeof themeGraphKeywordRollupSchema>;
export type ThemeGraphSummary = z.infer<typeof themeGraphSummarySchema>;
export type ThemeGraphStatsTheme = z.infer<typeof themeGraphStatsThemeSchema>;
export type ThemeGraphStatsView = z.infer<typeof themeGraphStatsViewSchema>;
export type ThemeGraphRankingBreakdown = z.infer<typeof themeGraphRankingBreakdownSchema>;
export type ThemeGraphRankingResult = z.infer<typeof themeGraphRankingResultSchema>;
export type ThemeGraphRankingView = z.infer<typeof themeGraphRankingViewSchema>;
export type ThemeGraphSearchResult = z.infer<typeof themeGraphSearchResultSchema>;
export type ThemeGraphSearchView = z.infer<typeof themeGraphSearchViewSchema>;
export type ThemeGraphView = z.infer<typeof themeGraphViewSchema>;
