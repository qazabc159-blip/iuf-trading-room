import { z } from "zod";

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1)
});

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["Owner", "Admin", "Analyst", "Trader", "Viewer"])
});

export const appSessionSchema = z.object({
  workspace: workspaceSchema,
  user: sessionUserSchema,
  persistenceMode: z.enum(["memory", "database"])
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type AppSession = z.infer<typeof appSessionSchema>;
