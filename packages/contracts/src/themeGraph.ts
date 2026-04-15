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
export type ThemeGraphView = z.infer<typeof themeGraphViewSchema>;
