import { sql as drizzleSql } from "drizzle-orm";
import { execRows, getDb, isDatabaseMode } from "@iuf-trading-room/db";

export async function resolvePrimaryWorkspaceId(): Promise<string | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  const configuredSlug = process.env.DEFAULT_WORKSPACE_SLUG?.trim();
  const rows = configuredSlug
    ? await db.execute(drizzleSql`
        SELECT id
        FROM workspaces
        ORDER BY CASE WHEN slug = ${configuredSlug} THEN 0 ELSE 1 END,
                 created_at ASC,
                 id ASC
        LIMIT 1
      `)
    : await db.execute(drizzleSql`
        SELECT id
        FROM workspaces
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `);

  return execRows<{ id?: string }>(rows)[0]?.id ?? null;
}

export async function listWorkspaceIds(): Promise<string[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const rows = await db.execute(drizzleSql`
    SELECT id
    FROM workspaces
    ORDER BY created_at ASC, id ASC
  `);
  return execRows<{ id?: string }>(rows)
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));
}
