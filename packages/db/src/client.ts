import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

let sqlClient: ReturnType<typeof postgres> | null = null;
let drizzleClient: DatabaseClient | null = null;

export function getPersistenceMode() {
  return process.env.PERSISTENCE_MODE === "database" ? "database" : "memory";
}

export function isDatabaseMode() {
  return getPersistenceMode() === "database";
}

export function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? null;
}

export function getDatabasePoolMax() {
  const raw = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(5, Math.min(raw, 10));
}

export function getDb() {
  if (!isDatabaseMode()) {
    return null;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=database");
  }

  if (!sqlClient) {
    sqlClient = postgres(databaseUrl, {
      max: getDatabasePoolMax()
    });
    drizzleClient = drizzle(sqlClient, { schema });
  }

  return drizzleClient;
}

export async function closeDb() {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
    drizzleClient = null;
  }
}
