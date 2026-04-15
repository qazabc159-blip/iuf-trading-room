import { z } from "zod";

import { beneficiaryTierSchema } from "./company.js";

export const companyRelationTypeSchema = z.enum([
  "supplier",
  "customer",
  "technology",
  "application",
  "co_occurrence",
  "unknown"
]);

export const companyRelationSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  targetCompanyId: z.string().uuid().nullable(),
  targetLabel: z.string().min(1).max(160),
  relationType: companyRelationTypeSchema,
  confidence: z.number().min(0).max(1),
  sourcePath: z.string().min(1).max(400),
  updatedAt: z.string()
});

export const companyRelationInputSchema = z.object({
  targetCompanyId: z.string().uuid().nullable().optional(),
  targetLabel: z.string().min(1).max(160),
  relationType: companyRelationTypeSchema,
  confidence: z.number().min(0).max(1),
  sourcePath: z.string().min(1).max(400)
});

export const companyRelationsReplaceInputSchema = z.object({
  relations: z.array(companyRelationInputSchema).max(2_500).default([])
});

export const companyKeywordSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  label: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  sourcePath: z.string().min(1).max(400),
  updatedAt: z.string()
});

export const companyKeywordInputSchema = z.object({
  label: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  sourcePath: z.string().min(1).max(400)
});

export const companyKeywordsReplaceInputSchema = z.object({
  keywords: z.array(companyKeywordInputSchema).max(2_500).default([])
});

export const companyGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["focus_company", "company", "external_label"]),
  companyId: z.string().uuid().nullable(),
  label: z.string().min(1).max(160),
  ticker: z.string().min(1).max(40).optional(),
  market: z.string().min(1).max(40).optional(),
  beneficiaryTier: beneficiaryTierSchema.optional(),
  relationCount: z.number().int().min(0).default(0),
  keywordCount: z.number().int().min(0).default(0)
});

export const companyGraphEdgeSchema = z.object({
  id: z.string().min(1),
  relationId: z.string().uuid(),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  direction: z.enum(["outbound", "inbound"]),
  relationType: companyRelationTypeSchema,
  confidence: z.number().min(0).max(1),
  sourcePath: z.string().min(1).max(400)
});

export const companyGraphSummarySchema = z.object({
  outboundRelations: z.number().int().min(0),
  inboundRelations: z.number().int().min(0),
  internalLinks: z.number().int().min(0),
  externalLinks: z.number().int().min(0),
  keywords: z.number().int().min(0)
});

export const companyGraphViewSchema = z.object({
  focusCompanyId: z.string().uuid(),
  generatedAt: z.string(),
  nodes: z.array(companyGraphNodeSchema),
  edges: z.array(companyGraphEdgeSchema),
  keywords: z.array(companyKeywordSchema),
  summary: companyGraphSummarySchema
});

export const companyGraphSearchResultSchema = z.object({
  companyId: z.string().uuid(),
  ticker: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  market: z.string().min(1).max(40),
  country: z.string().min(1).max(80),
  beneficiaryTier: beneficiaryTierSchema,
  chainPosition: z.string().min(1).max(160),
  relationCount: z.number().int().min(0),
  keywordCount: z.number().int().min(0),
  matchedBy: z.array(z.enum(["ticker", "name", "keyword", "relation"])).min(1),
  score: z.number().min(0)
});

export const companyGraphStatsSchema = z.object({
  generatedAt: z.string(),
  companiesWithGraph: z.number().int().min(0),
  totalRelations: z.number().int().min(0),
  totalKeywords: z.number().int().min(0),
  relationTypes: z.array(
    z.object({
      relationType: companyRelationTypeSchema,
      count: z.number().int().min(0)
    })
  ),
  topKeywords: z.array(
    z.object({
      label: z.string().min(1).max(120),
      count: z.number().int().min(0)
    })
  ),
  topConnectedCompanies: z.array(
    z.object({
      companyId: z.string().uuid(),
      ticker: z.string().min(1).max(40),
      name: z.string().min(1).max(160),
      relationCount: z.number().int().min(0),
      keywordCount: z.number().int().min(0)
    })
  )
});

export type CompanyRelationType = z.infer<typeof companyRelationTypeSchema>;
export type CompanyRelation = z.infer<typeof companyRelationSchema>;
export type CompanyRelationInput = z.infer<typeof companyRelationInputSchema>;
export type CompanyRelationsReplaceInput = z.infer<typeof companyRelationsReplaceInputSchema>;
export type CompanyKeyword = z.infer<typeof companyKeywordSchema>;
export type CompanyKeywordInput = z.infer<typeof companyKeywordInputSchema>;
export type CompanyKeywordsReplaceInput = z.infer<typeof companyKeywordsReplaceInputSchema>;
export type CompanyGraphNode = z.infer<typeof companyGraphNodeSchema>;
export type CompanyGraphEdge = z.infer<typeof companyGraphEdgeSchema>;
export type CompanyGraphSummary = z.infer<typeof companyGraphSummarySchema>;
export type CompanyGraphView = z.infer<typeof companyGraphViewSchema>;
export type CompanyGraphSearchResult = z.infer<typeof companyGraphSearchResultSchema>;
export type CompanyGraphStats = z.infer<typeof companyGraphStatsSchema>;
