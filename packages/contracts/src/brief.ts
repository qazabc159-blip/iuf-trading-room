import { z } from "zod";

export const briefSectionSchema = z.object({
  heading: z.string(),
  body: z.string()
});

export const dailyBriefSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  marketState: z.string(),
  sections: z.array(briefSectionSchema),
  generatedBy: z.enum(["manual", "openalice"]),
  status: z.enum(["draft", "published"]),
  createdAt: z.string()
});

export const dailyBriefCreateInputSchema = z.object({
  date: z.string().min(1).max(10),
  marketState: z.string().min(1).max(100),
  sections: z.array(
    z.object({
      heading: z.string().min(1).max(200),
      body: z.string().min(1).max(5000)
    })
  ).min(1),
  generatedBy: z.enum(["manual", "openalice"]).default("manual"),
  status: z.enum(["draft", "published"]).default("draft")
});

export type BriefSection = z.infer<typeof briefSectionSchema>;
export type DailyBrief = z.infer<typeof dailyBriefSchema>;
export type DailyBriefCreateInput = z.infer<typeof dailyBriefCreateInputSchema>;
