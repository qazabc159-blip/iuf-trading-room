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
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
    .sort((left, right) => left.localeCompare(right));
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
    await sql`SELECT pg_advisory_lock(${lockKeyA}, ${lockKeyB})`;
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
