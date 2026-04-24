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

// ── CompanyNote ───────────────────────────────────────────────────────────────

export const companyNoteSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  companyId: z.string().uuid(),
  note: z.string(),
  generatedAt: z.string()
});

export type CompanyNote = z.infer<typeof companyNoteSchema>;
