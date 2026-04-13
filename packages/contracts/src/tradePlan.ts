import { z } from "zod";

export const tradePlanStatusSchema = z.enum([
  "draft",
  "ready",
  "active",
  "reduced",
  "closed",
  "canceled"
]);

export const tradePlanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  status: tradePlanStatusSchema,
  entryPlan: z.string(),
  invalidationPlan: z.string(),
  targetPlan: z.string(),
  riskReward: z.string(),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const tradePlanCreateInputSchema = z.object({
  companyId: z.string().uuid(),
  status: tradePlanStatusSchema.default("draft"),
  entryPlan: z.string().min(1).max(2000),
  invalidationPlan: z.string().min(1).max(2000),
  targetPlan: z.string().min(1).max(2000),
  riskReward: z.string().max(1000).default(""),
  notes: z.string().max(2000).default("")
});

export const tradePlanUpdateInputSchema = tradePlanCreateInputSchema
  .omit({ companyId: true })
  .partial();

export type TradePlanStatus = z.infer<typeof tradePlanStatusSchema>;
export type TradePlan = z.infer<typeof tradePlanSchema>;
export type TradePlanCreateInput = z.infer<typeof tradePlanCreateInputSchema>;
export type TradePlanUpdateInput = z.infer<typeof tradePlanUpdateInputSchema>;
