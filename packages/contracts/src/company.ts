import { z } from "zod";

export const beneficiaryTierSchema = z.enum([
  "Core",
  "Direct",
  "Indirect",
  "Observation"
]);

export const exposureBreakdownSchema = z.object({
  volume: z.number().int().min(1).max(5),
  asp: z.number().int().min(1).max(5),
  margin: z.number().int().min(1).max(5),
  capacity: z.number().int().min(1).max(5),
  narrative: z.number().int().min(1).max(5)
});

export const validationSnapshotSchema = z.object({
  capitalFlow: z.string(),
  consensus: z.string(),
  relativeStrength: z.string()
});

export const companySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  ticker: z.string().min(1),
  market: z.string().min(1),
  country: z.string().min(1),
  themeIds: z.array(z.string().uuid()),
  chainPosition: z.string().min(1),
  beneficiaryTier: beneficiaryTierSchema,
  exposure: exposureBreakdownSchema,
  validation: validationSnapshotSchema,
  notes: z.string(),
  updatedAt: z.string()
});

export const companyCreateInputSchema = z.object({
  name: z.string().min(1).max(120),
  ticker: z.string().min(1).max(40),
  market: z.string().min(1).max(40),
  country: z.string().min(1).max(80),
  themeIds: z.array(z.string().uuid()).default([]),
  chainPosition: z.string().min(1).max(160),
  beneficiaryTier: beneficiaryTierSchema,
  exposure: exposureBreakdownSchema,
  validation: validationSnapshotSchema,
  notes: z.string().min(1).max(1500)
});

export const companyUpdateInputSchema = companyCreateInputSchema.partial();

export type BeneficiaryTier = z.infer<typeof beneficiaryTierSchema>;
export type ExposureBreakdown = z.infer<typeof exposureBreakdownSchema>;
export type ValidationSnapshot = z.infer<typeof validationSnapshotSchema>;
export type Company = z.infer<typeof companySchema>;
export type CompanyCreateInput = z.infer<typeof companyCreateInputSchema>;
export type CompanyUpdateInput = z.infer<typeof companyUpdateInputSchema>;
