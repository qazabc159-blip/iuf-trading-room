import { z } from "zod";

import { beneficiaryTierSchema } from "./company.js";

export const companyDuplicateEntrySchema = z.object({
  companyId: z.string().uuid(),
  ticker: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  market: z.string().min(1).max(40),
  country: z.string().min(1).max(80),
  beneficiaryTier: beneficiaryTierSchema,
  themeCount: z.number().int().min(0),
  relationCount: z.number().int().min(0),
  keywordCount: z.number().int().min(0),
  updatedAt: z.string()
});

export const companyDuplicateGroupSchema = z.object({
  groupKey: z.string().min(1),
  ticker: z.string().min(1).max(40),
  normalizedName: z.string().min(1).max(160),
  duplicateCount: z.number().int().min(2),
  recommendedCompanyId: z.string().uuid(),
  reason: z.string().min(1).max(240),
  companies: z.array(companyDuplicateEntrySchema).min(2)
});

export const companyDuplicateReportSummarySchema = z.object({
  groupCount: z.number().int().min(0),
  companyCount: z.number().int().min(0)
});

export const companyDuplicateReportSchema = z.object({
  generatedAt: z.string(),
  groups: z.array(companyDuplicateGroupSchema),
  summary: companyDuplicateReportSummarySchema
});

export type CompanyDuplicateEntry = z.infer<typeof companyDuplicateEntrySchema>;
export type CompanyDuplicateGroup = z.infer<typeof companyDuplicateGroupSchema>;
export type CompanyDuplicateReportSummary = z.infer<typeof companyDuplicateReportSummarySchema>;
export type CompanyDuplicateReport = z.infer<typeof companyDuplicateReportSchema>;
