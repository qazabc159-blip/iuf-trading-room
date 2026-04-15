import { z } from "zod";

import { beneficiaryTierSchema } from "./company.js";

export const companyMergeInputSchema = z.object({
  targetCompanyId: z.string().uuid(),
  sourceCompanyIds: z.array(z.string().uuid()).min(1).max(20),
  force: z.boolean().default(false),
  appendSourceNotes: z.boolean().default(true)
});

export const companyMergeCompanySummarySchema = z.object({
  companyId: z.string().uuid(),
  ticker: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  market: z.string().min(1).max(40),
  country: z.string().min(1).max(80),
  beneficiaryTier: beneficiaryTierSchema,
  themeCount: z.number().int().min(0),
  relationCount: z.number().int().min(0),
  keywordCount: z.number().int().min(0),
  tradePlanCount: z.number().int().min(0),
  updatedAt: z.string()
});

export const companyMergeImpactSchema = z.object({
  themeIdsToAttach: z.number().int().min(0),
  outgoingRelationRowsToRewrite: z.number().int().min(0),
  incomingRelationRowsToRewrite: z.number().int().min(0),
  keywordRowsToRewrite: z.number().int().min(0),
  tradePlansToReassign: z.number().int().min(0),
  duplicateRelationsCollapsed: z.number().int().min(0),
  duplicateKeywordsCollapsed: z.number().int().min(0),
  sourceCompaniesToDelete: z.number().int().min(0),
  notesAppended: z.boolean()
});

export const companyMergePreviewSchema = z.object({
  generatedAt: z.string(),
  allowed: z.boolean(),
  warnings: z.array(z.string()),
  target: companyMergeCompanySummarySchema,
  sources: z.array(companyMergeCompanySummarySchema).min(1),
  impact: companyMergeImpactSchema
});

export const companyMergeResultSchema = z.object({
  mergedAt: z.string(),
  targetCompanyId: z.string().uuid(),
  deletedCompanyIds: z.array(z.string().uuid()),
  impact: companyMergeImpactSchema,
  warnings: z.array(z.string())
});

export type CompanyMergeInput = z.infer<typeof companyMergeInputSchema>;
export type CompanyMergeCompanySummary = z.infer<typeof companyMergeCompanySummarySchema>;
export type CompanyMergeImpact = z.infer<typeof companyMergeImpactSchema>;
export type CompanyMergePreview = z.infer<typeof companyMergePreviewSchema>;
export type CompanyMergeResult = z.infer<typeof companyMergeResultSchema>;
