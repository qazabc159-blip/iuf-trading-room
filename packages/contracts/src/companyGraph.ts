import { z } from "zod";

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

export type CompanyRelationType = z.infer<typeof companyRelationTypeSchema>;
export type CompanyRelation = z.infer<typeof companyRelationSchema>;
export type CompanyRelationInput = z.infer<typeof companyRelationInputSchema>;
export type CompanyRelationsReplaceInput = z.infer<typeof companyRelationsReplaceInputSchema>;
export type CompanyKeyword = z.infer<typeof companyKeywordSchema>;
export type CompanyKeywordInput = z.infer<typeof companyKeywordInputSchema>;
export type CompanyKeywordsReplaceInput = z.infer<typeof companyKeywordsReplaceInputSchema>;
