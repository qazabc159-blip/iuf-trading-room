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
  if (!Number.isFinite(raw)) return 10;
  return Math.max(10, Math.min(raw, 20));
}

export function getDatabaseConnectTimeoutSeconds() {
  const raw = Number.parseInt(process.env.DATABASE_CONNECT_TIMEOUT_SECONDS ?? "", 10);
  if (!Number.isFinite(raw)) return 15;
  return Math.max(3, Math.min(raw, 15));
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
      max: getDatabasePoolMax(),
      connect_timeout: getDatabaseConnectTimeoutSeconds(),
      idle_timeout: 20
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

/**
 * Canonical normalizer for `db.execute()` results.
 *
 * This repo's driver is drizzle-orm/postgres-js, whose `execute()` returns the
 * row array DIRECTLY — there is NO `.rows` wrapper. Reading `result.rows` on it
 * yields `undefined`, which silently degrades to an empty result and has caused
 * a whole class of "0 rows forever" bugs (ai-rec perf store, alerts engine,
 * heatmap, etc). ALWAYS pass `db.execute(...)` results through this helper
 * instead of reading `.rows`. Accepts both shapes defensively so it also works
 * if a node-postgres client is ever introduced.
 */
export function execRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const wrapped = result as { rows?: T[] } | null | undefined;
  return Array.isArray(wrapped?.rows) ? (wrapped!.rows as T[]) : [];
}
