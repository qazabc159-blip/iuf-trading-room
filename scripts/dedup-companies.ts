/**
 * dedup-companies.ts — dry-run / live dedup for companies table
 *
 * Usage:
 *   DRY_RUN=true  node --import tsx/esm scripts/dedup-companies.ts
 *   DRY_RUN=false node --import tsx/esm scripts/dedup-companies.ts
 *
 * Hard lines:
 *   - DRY_RUN=false required explicitly to execute DELETE
 *   - Reports row counts before and after
 *   - Never truncates; only removes rows where a survivor with MIN(id) exists
 *   - Safe to re-run after migration 0030 (index prevents new dups)
 */

import postgres from "postgres";
import process from "node:process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[dedup-companies] ERROR: DATABASE_URL not set");
  process.exit(1);
}

const dryRun = process.env.DRY_RUN !== "false";
console.log(`[dedup-companies] mode=${dryRun ? "DRY_RUN" : "LIVE"}`);

const sql = postgres(databaseUrl, { max: 1 });

async function main() {
  // 1. Count current total rows
  const [{ total }] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM companies
  `;
  console.log(`[dedup-companies] total rows before: ${total}`);

  // 2. Identify duplicate rows (not the survivor)
  const dups = await sql<{ workspace_id: string; ticker: string; dup_count: string }[]>`
    SELECT workspace_id::text, ticker, (COUNT(*) - 1)::text AS dup_count
    FROM companies
    GROUP BY workspace_id, ticker
    HAVING COUNT(*) > 1
    ORDER BY dup_count DESC
    LIMIT 20
  `;

  if (dups.length === 0) {
    console.log("[dedup-companies] No duplicates found. Nothing to do.");
    await sql.end();
    return;
  }

  const totalDups = dups.reduce((acc, r) => acc + parseInt(r.dup_count, 10), 0);
  console.log(`[dedup-companies] duplicate (workspace_id, ticker) pairs: ${dups.length}`);
  console.log(`[dedup-companies] total excess rows to delete: ${totalDups}`);
  console.log("[dedup-companies] top duplicates (workspace_id, ticker, count):");
  for (const d of dups.slice(0, 10)) {
    console.log(`  workspace=${d.workspace_id} ticker=${d.ticker} excess=${d.dup_count}`);
  }

  if (dryRun) {
    console.log("[dedup-companies] DRY_RUN=true — no DELETE executed.");
    console.log("[dedup-companies] To run live: DRY_RUN=false node --import tsx/esm scripts/dedup-companies.ts");
    await sql.end();
    return;
  }

  // 3. Execute dedup DELETE
  console.log("[dedup-companies] Executing DELETE...");
  const result = await sql`
    DELETE FROM companies
    WHERE id NOT IN (
      SELECT MIN(id)::uuid
      FROM companies
      GROUP BY workspace_id, ticker
    )
  `;
  console.log(`[dedup-companies] DELETE done. rows affected: ${result.count}`);

  // 4. Count rows after
  const [{ totalAfter }] = await sql<{ totalAfter: string }[]>`
    SELECT COUNT(*)::text AS "totalAfter" FROM companies
  `;
  console.log(`[dedup-companies] total rows after: ${totalAfter}`);
  console.log(`[dedup-companies] delta: ${parseInt(total, 10) - parseInt(totalAfter, 10)} rows removed`);

  await sql.end();
}

main().catch((err) => {
  console.error("[dedup-companies] FATAL:", err);
  process.exit(1);
});
