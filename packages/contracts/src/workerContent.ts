import { z } from "zod";

// ── ThemeSummary ─────────────────────────────────────────────────────────────

export const themeSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  themeId: z.string().uuid(),
  summary: z.string(),
  companyCount: z.number().int(),
  generatedAt: z.string()
});

export type ThemeSummary = z.infer<typeof themeSummarySchema>;

export const themeSummaryListResponseSchema = z.object({
  data: z.array(themeSummarySchema)
});

export type ThemeSummaryListResponse = z.infer<typeof themeSummaryListResponseSchema>;

// ── CompanyNote ───────────────────────────────────────────────────────────────

export const companyNoteSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  companyId: z.string().uuid(),
  note: z.string(),
  generatedAt: z.string()
});

export type CompanyNote = z.infer<typeof companyNoteSchema>;

export const companyNoteListResponseSchema = z.object({
  data: z.array(companyNoteSchema)
});

export type CompanyNoteListResponse = z.infer<typeof companyNoteListResponseSchema>;

// ── ReviewSummary ─────────────────────────────────────────────────────────────

export const reviewSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  themeId: z.string().uuid(),
  bodyMd: z.string(),
  period: z.enum(["week", "month"]),
  generatedAt: z.string(),
  updatedAt: z.string()
});

export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const reviewSummaryListResponseSchema = z.object({
  data: z.array(reviewSummarySchema)
});

export type ReviewSummaryListResponse = z.infer<typeof reviewSummaryListResponseSchema>;

// ── SignalCluster ─────────────────────────────────────────────────────────────

export const signalClusterSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  label: z.string(),
  memberTickers: z.array(z.string()),
  memberThemes: z.array(z.string()),
  rationaleMarkdown: z.string(),
  generatedAt: z.string(),
  updatedAt: z.string()
});

export type SignalCluster = z.infer<typeof signalClusterSchema>;

export const signalClusterListResponseSchema = z.object({
  data: z.array(signalClusterSchema)
});

export type SignalClusterListResponse = z.infer<typeof signalClusterListResponseSchema>;
