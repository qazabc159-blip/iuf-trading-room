import { z } from "zod";

export const signalCategorySchema = z.enum([
  "macro",
  "industry",
  "company",
  "price",
  "portfolio"
]);

export const signalDirectionSchema = z.enum([
  "bullish",
  "bearish",
  "neutral"
]);

export const signalSchema = z.object({
  id: z.string().uuid(),
  category: signalCategorySchema,
  direction: signalDirectionSchema,
  title: z.string().min(1),
  summary: z.string(),
  confidence: z.number().int().min(1).max(5),
  themeIds: z.array(z.string().uuid()),
  companyIds: z.array(z.string().uuid()),
  createdAt: z.string()
});

export const signalCreateInputSchema = z.object({
  category: signalCategorySchema,
  direction: signalDirectionSchema,
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).default(""),
  confidence: z.number().int().min(1).max(5),
  themeIds: z.array(z.string().uuid()).default([]),
  companyIds: z.array(z.string().uuid()).default([])
});

export const signalUpdateInputSchema = signalCreateInputSchema.partial();

export type SignalCategory = z.infer<typeof signalCategorySchema>;
export type SignalDirection = z.infer<typeof signalDirectionSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type SignalCreateInput = z.infer<typeof signalCreateInputSchema>;
export type SignalUpdateInput = z.infer<typeof signalUpdateInputSchema>;
