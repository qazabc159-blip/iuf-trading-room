/**
 * dedup-companies.ts — dry-run / live dedup for companies table
 *
 * Usage:
 *   DRY_RUN=true  node --import tsx/esm scripts/dedup-companies.ts
 *   DRY_RUN=false node --import tsx/esm scripts/dedup-companies.ts
 *
 * Hard lines:
 *   - DRY_RUN=false required explicitly to execute FK rewire + DELETE
 *   - Reports FK child row counts affected per table before executing
 *   - Never truncates; only removes rows where a survivor with MIN(id) exists
 *   - MIN(id) = lexicographically smallest UUID per (workspace_id, ticker) group
 *   - Safe to re-run after migration 0031 (index prevents new dups)
 *
 * FK preview (DRY_RUN mode prints affected row counts per child table):
 *   1. company_theme_links.company_id
 *   2. company_relations.company_id
 *   3. company_relations.target_company_id
 *   4. company_keywords.company_id
 *   5. trade_plans.company_id
 *   6. company_notes.company_id
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

// Build the survivor subquery once (reused across FK preview queries)
const SURVIVOR_SUBQUERY = sql`
  SELECT MIN(id) AS survivor_id, workspace_id, ticker
  FROM companies
  GROUP BY workspace_id, ticker
`;

async function previewFkImpact() {
  console.log("[dedup-companies] === FK child table impact preview ===");

  // 1. company_theme_links.company_id
  const [ctl] = await sql<{ affected: string }[]>`
    SELECT COUNT(*)::text AS affected
    FROM company_theme_links ctl
    WHERE ctl.company_id IN (
      SELECT dup.id FROM companies dup
      JOIN (${SURVIVOR_SUBQUERY}) s
        ON s.workspace_id = dup.workspace_id AND s.ticker = dup.ticker
      WHERE dup.id != s.survivor_id
    )
  `;
  console.log(`  company_theme_links.company_id       → ${ctl.affected} rows to rewire`);

  // 2. company_relations.company_id
  const [cr1] = await sql<{ affected: string }[]>`
    SELECT COUNT(*)::text AS affected
    FROM company_relations cr
    WHERE cr.company_id IN (
      SELECT dup.id FROM companies dup
      JOIN (${SURVIVOR_SUBQUERY}) s
        ON s.workspace_id = dup.workspace_id AND s.ticker = dup.ticker
      WHERE dup.id != s.survivor_id
    )
  `;
  console.log(`  company_relations.company_id         → ${cr1.affected} rows to rewire`);

  // 3. company_relations.target_company_id
  const [cr2] = await sql<{ affected: string }[]>`
    SELECT COUNT(*)::text AS affected
    FROM company_relations cr
    WHERE cr.target_company_id IN (
      SELECT dup.id FROM companies dup
      JOIN (${SURVIVOR_SUBQUERY}) s
        ON s.workspace_id = dup.workspace_id AND s.ticker = dup.ticker
      WHERE dup.id != s.survivor_id
    )
  `;
  console.log(`  company_relations.target_company_id  → ${cr2.affected} rows to rewire`);

  // 4. company_keywords.company_id
  const [ck] = await sql<{ affected: string }[]>`
    SELECT COUNT(*)::text AS affected
    FROM company_keywords ck
    WHERE ck.company_id IN (
      SELECT dup.id FROM companies dup
      JOIN (${SURVIVOR_SUBQUERY}) s
        ON s.workspace_id = dup.workspace_id AND s.ticker = dup.ticker
      WHERE dup.id != s.survivor_id
    )
  `;
  console.log(`  company_keywords.company_id          → ${ck.affected} rows to rewire`);

  // 5. trade_plans.company_id
  const [tp] = await sql<{ affected: string }[]>`
    SELECT COUNT(*)::text AS affected
    FROM trade_plans tp
    WHERE tp.company_id IN (
      SELECT dup.id FROM companies dup
      JOIN (${SURVIVOR_SUBQUERY}) s
        ON s.workspace_id = dup.workspace_id AND s.ticker = dup.ticker
      WHERE dup.id != s.survivor_id
    )
  `;
  console.log(`  trade_plans.company_id               → ${tp.affected} rows to rewire`);

  // 6. company_notes.company_id
  const [cn] = await sql<{ affected: string }[]>`
    SELECT COUNT(*)::text AS affected
    FROM company_notes cn
    WHERE cn.company_id IN (
      SELECT dup.id FROM companies dup
      JOIN (${SURVIVOR_SUBQUERY}) s
        ON s.workspace_id = dup.workspace_id AND s.ticker = dup.ticker
      WHERE dup.id != s.survivor_id
    )
  `;
  console.log(`  company_notes.company_id             → ${cn.affected} rows to rewire`);

  console.log("[dedup-companies] === end FK preview ===");
}

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

  // 3. Always show FK impact preview (dry-run or live)
  await previewFkImpact();

  if (dryRun) {
    console.log("[dedup-companies] DRY_RUN=true — no rewire/DELETE executed.");
    console.log("[dedup-companies] To run live: DRY_RUN=false node --import tsx/esm scripts/dedup-companies.ts");
    console.log("[dedup-companies] IMPORTANT: Take a Railway DB snapshot before running live.");
    await sql.end();
    return;
  }

  // 4. Execute FK rewire for all 6 child tables, then DELETE
  console.log("[dedup-companies] Executing FK rewire + DELETE...");

  // Step 1a: company_theme_links.company_id
  const ctl = await sql`
    UPDATE company_theme_links ctl
    SET company_id = survivor.id
    FROM (
      SELECT MIN(id) AS id, workspace_id, ticker
      FROM companies GROUP BY workspace_id, ticker
    ) survivor
    JOIN companies dup
      ON dup.workspace_id = survivor.workspace_id
      AND dup.ticker = survivor.ticker
      AND dup.id != survivor.id
    WHERE ctl.company_id = dup.id
  `;
  console.log(`[dedup-companies] company_theme_links rewired: ${ctl.count} rows`);

  // Step 1b: company_relations.company_id
  const cr1 = await sql`
    UPDATE company_relations cr
    SET company_id = survivor.id
    FROM (
      SELECT MIN(id) AS id, workspace_id, ticker
      FROM companies GROUP BY workspace_id, ticker
    ) survivor
    JOIN companies dup
      ON dup.workspace_id = survivor.workspace_id
      AND dup.ticker = survivor.ticker
      AND dup.id != survivor.id
    WHERE cr.company_id = dup.id
  `;
  console.log(`[dedup-companies] company_relations.company_id rewired: ${cr1.count} rows`);

  // Step 1c: company_relations.target_company_id
  const cr2 = await sql`
    UPDATE company_relations cr
    SET target_company_id = survivor.id
    FROM (
      SELECT MIN(id) AS id, workspace_id, ticker
      FROM companies GROUP BY workspace_id, ticker
    ) survivor
    JOIN companies dup
      ON dup.workspace_id = survivor.workspace_id
      AND dup.ticker = survivor.ticker
      AND dup.id != survivor.id
    WHERE cr.target_company_id = dup.id
  `;
  console.log(`[dedup-companies] company_relations.target_company_id rewired: ${cr2.count} rows`);

  // Step 1d: company_keywords.company_id
  const ck = await sql`
    UPDATE company_keywords ck
    SET company_id = survivor.id
    FROM (
      SELECT MIN(id) AS id, workspace_id, ticker
      FROM companies GROUP BY workspace_id, ticker
    ) survivor
    JOIN companies dup
      ON dup.workspace_id = survivor.workspace_id
      AND dup.ticker = survivor.ticker
      AND dup.id != survivor.id
    WHERE ck.company_id = dup.id
  `;
  console.log(`[dedup-companies] company_keywords rewired: ${ck.count} rows`);

  // Step 1e: trade_plans.company_id
  const tp = await sql`
    UPDATE trade_plans tp
    SET company_id = survivor.id
    FROM (
      SELECT MIN(id) AS id, workspace_id, ticker
      FROM companies GROUP BY workspace_id, ticker
    ) survivor
    JOIN companies dup
      ON dup.workspace_id = survivor.workspace_id
      AND dup.ticker = survivor.ticker
      AND dup.id != survivor.id
    WHERE tp.company_id = dup.id
  `;
  console.log(`[dedup-companies] trade_plans rewired: ${tp.count} rows`);

  // Step 1f: company_notes.company_id
  const cn = await sql`
    UPDATE company_notes cn
    SET company_id = survivor.id
    FROM (
      SELECT MIN(id) AS id, workspace_id, ticker
      FROM companies GROUP BY workspace_id, ticker
    ) survivor
    JOIN companies dup
      ON dup.workspace_id = survivor.workspace_id
      AND dup.ticker = survivor.ticker
      AND dup.id != survivor.id
    WHERE cn.company_id = dup.id
  `;
  console.log(`[dedup-companies] company_notes rewired: ${cn.count} rows`);

  // Step 2: Safe DELETE
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

  // 5. Validate: expected ~1736 rows after
  const [{ totalAfter }] = await sql<{ totalAfter: string }[]>`
    SELECT COUNT(*)::text AS "totalAfter" FROM companies
  `;
  console.log(`[dedup-companies] total rows after: ${totalAfter}`);
  console.log(`[dedup-companies] delta: ${parseInt(total, 10) - parseInt(totalAfter, 10)} rows removed`);

  const afterCount = parseInt(totalAfter, 10);
  if (afterCount > 2000 || afterCount < 1000) {
    console.warn(`[dedup-companies] WARNING: unexpected row count after dedup: ${afterCount}. Expected ~1734-1736. Verify before proceeding.`);
  } else {
    console.log(`[dedup-companies] row count looks healthy (${afterCount} in expected range 1000-2000).`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error("[dedup-companies] FATAL:", err);
  process.exit(1);
});
