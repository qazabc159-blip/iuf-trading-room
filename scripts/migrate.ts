import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(repoRoot, "packages", "db", "migrations");
const lockKeyA = 9412;
const lockKeyB = 20260413;

export function getMigrationFiles(directory = migrationsDir) {
  return fs
    .readdirSync(directory)
    .filter(
      (file) =>
        file.endsWith(".sql") &&
        !file.endsWith(".down.sql") &&
        // Mike + Bruce PR #224 audit BLOCKER 2026-05-06:
        // .DRAFT.sql migrations must NOT auto-apply. Strip the .DRAFT. infix
        // (rename file) only after Mike audit + Owner promote.
        !file.includes(".DRAFT.")
    )
    .sort((left, right) => left.localeCompare(right));
}

// F3: Advisory lock retry — 5 attempts, 30s between each.
// Root cause: concurrent deploys (6 in 30 min) caused pg_advisory_lock contention
// with 15s lock_timeout → exit 1 → silent degraded mode → prod schema stale.
const LOCK_MAX_ATTEMPTS = 5;
const LOCK_RETRY_DELAY_MS = 30_000;

async function acquireAdvisoryLockWithRetry(sql: ReturnType<typeof postgres>): Promise<void> {
  for (let attempt = 1; attempt <= LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      await sql`SET lock_timeout = '15s'`;
      await sql`SELECT pg_advisory_lock(${lockKeyA}, ${lockKeyB})`;
      await sql`RESET lock_timeout`;
      console.log(`[migrate] Advisory lock acquired on attempt ${attempt}/${LOCK_MAX_ATTEMPTS}`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < LOCK_MAX_ATTEMPTS) {
        console.warn(
          `[migrate] ADVISORY_LOCK_CONTENTION attempt ${attempt}/${LOCK_MAX_ATTEMPTS} — ${msg}. Retrying in ${LOCK_RETRY_DELAY_MS / 1000}s…`
        );
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      } else {
        console.error(
          `[migrate] ADVISORY_LOCK_CONTENTION_GIVEUP — failed to acquire advisory lock after ${LOCK_MAX_ATTEMPTS} attempts. Last error: ${msg}`
        );
        process.exit(1);
      }
    }
  }
}

export async function main() {
  const persistenceMode = process.env.PERSISTENCE_MODE ?? "memory";
  if (persistenceMode !== "database") {
    console.log("[migrate] Skipping migrations because PERSISTENCE_MODE is not database.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const sql = postgres(databaseUrl, {
    max: 1
  });

  try {
    // F3: Use retry wrapper instead of single-shot lock attempt.
    // Cycle 9.6 original: set lock_timeout so a stale advisory lock from a crashed
    // prior deploy doesn't hang this process indefinitely.
    await acquireAdvisoryLockWithRetry(sql);

    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const appliedRows = await sql<{ version: string }[]>`
      SELECT version
      FROM schema_migrations
      ORDER BY version ASC
    `;
    const applied = new Set(appliedRows.map((row) => row.version));

    for (const file of getMigrationFiles()) {
      if (applied.has(file)) {
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sqlText = fs.readFileSync(fullPath, "utf8");
      console.log(`[migrate] Applying ${file}`);

      await sql.begin(async (transaction) => {
        await transaction.unsafe(sqlText);
        await transaction`
          INSERT INTO schema_migrations (version)
          VALUES (${file})
        `;
      });
    }

    // F1: After applying all migrations, verify count against EXPECTED_MIGRATION_COUNT.
    // This catches cases where new migration files were added but deploy did not run them
    // (e.g. advisory lock gave up silently in a previous deploy).
    const expectedCountEnv = process.env.EXPECTED_MIGRATION_COUNT;
    if (expectedCountEnv) {
      const expectedCount = Number(expectedCountEnv);
      const repoFileCount = getMigrationFiles().length;
      const appliedAfter = await sql<{ cnt: number }[]>`
        SELECT COUNT(*)::int AS cnt FROM schema_migrations
      `;
      const appliedCount = appliedAfter[0]?.cnt ?? 0;

      if (appliedCount !== expectedCount) {
        console.error(
          `[migrate] MIGRATION_COUNT_MISMATCH: expected ${expectedCount} got ${appliedCount} — blocking boot`
        );
        process.exit(1);
      }
      if (repoFileCount !== expectedCount) {
        console.warn(
          `[migrate] MIGRATION_FILE_COUNT_DRIFT: repo has ${repoFileCount} files but EXPECTED_MIGRATION_COUNT=${expectedCount}. Update env var.`
        );
      }
      console.log(`[migrate] Migration count verified: ${appliedCount}/${expectedCount} OK`);
    }

    console.log("[migrate] Database schema is up to date.");
  } finally {
    await sql`SELECT pg_advisory_unlock(${lockKeyA}, ${lockKeyB})`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[migrate] Failed", error);
    process.exitCode = 1;
  });
}
