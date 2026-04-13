import { z } from "zod";

export const reviewEntrySchema = z.object({
  id: z.string().uuid(),
  tradePlanId: z.string().uuid(),
  outcome: z.string(),
  attribution: z.string(),
  lesson: z.string(),
  setupTags: z.array(z.string()),
  executionQuality: z.number().int().min(1).max(5),
  createdAt: z.string()
});

export const reviewEntryCreateInputSchema = z.object({
  tradePlanId: z.string().uuid(),
  outcome: z.string().min(1).max(2000),
  attribution: z.string().max(2000).default(""),
  lesson: z.string().max(2000).default(""),
  setupTags: z.array(z.string().max(50)).default([]),
  executionQuality: z.number().int().min(1).max(5)
});

export type ReviewEntry = z.infer<typeof reviewEntrySchema>;
export type ReviewEntryCreateInput = z.infer<typeof reviewEntryCreateInputSchema>;
