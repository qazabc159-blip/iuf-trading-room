import { z } from "zod";

export const marketStateSchema = z.enum([
  "Attack",
  "Selective Attack",
  "Balanced",
  "Defense",
  "Preservation"
]);

export const themeLifecycleSchema = z.enum([
  "Discovery",
  "Validation",
  "Expansion",
  "Crowded",
  "Distribution"
]);

export const themeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  marketState: marketStateSchema,
  lifecycle: themeLifecycleSchema,
  priority: z.number().int().min(1).max(5),
  thesis: z.string(),
  whyNow: z.string(),
  bottleneck: z.string(),
  corePoolCount: z.number().int().min(0),
  observationPoolCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const themeCreateInputSchema = z.object({
  name: z.string().min(1).max(120),
  marketState: marketStateSchema,
  lifecycle: themeLifecycleSchema,
  priority: z.number().int().min(1).max(5),
  thesis: z.string().min(1).max(1500),
  whyNow: z.string().min(1).max(1500),
  bottleneck: z.string().min(1).max(800)
});

export const themeUpdateInputSchema = themeCreateInputSchema.partial();

export type MarketState = z.infer<typeof marketStateSchema>;
export type ThemeLifecycle = z.infer<typeof themeLifecycleSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type ThemeCreateInput = z.infer<typeof themeCreateInputSchema>;
export type ThemeUpdateInput = z.infer<typeof themeUpdateInputSchema>;
