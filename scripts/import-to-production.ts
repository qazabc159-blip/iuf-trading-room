/**
 * Import My-TW-Coverage companies to the production Railway API.
 *
 * Usage:
 *   npx tsx scripts/import-to-production.ts
 *
 * Env:
 *   API_URL - production API base
 *   COVERAGE_PATH - path to the My-TW-Coverage repo root
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildImportedCompanyDraft,
  runImport
} from "../packages/integrations/src/my-tw-coverage/importer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const API_URL = process.env.API_URL ?? "https://api-production-8f08.up.railway.app";
const COVERAGE_PATH = process.env.COVERAGE_PATH ?? path.resolve(repoRoot, "..", "My-TW-Coverage");
const WORKSPACE_SLUG = "primary-desk";
const BATCH_SIZE = 10;

console.log(`[import] Parsing coverage at: ${COVERAGE_PATH}`);
const result = runImport({ coveragePath: COVERAGE_PATH });
console.log(
  `[import] Parsed: ${result.companies.length} companies, ${result.relations.length} relations, ${result.themeKeywords.length} keywords`
);

const headers = {
  "Content-Type": "application/json",
  "x-workspace-slug": WORKSPACE_SLUG
};

async function main() {
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  async function createCompany(seed: (typeof result.companies)[number]) {
    const body = buildImportedCompanyDraft(seed);

    try {
      const response = await fetch(`${API_URL}/api/v1/companies`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (response.status === 201) {
        created += 1;
        return;
      }

      const text = await response.text();
      if (text.includes("duplicate") || text.includes("already exists")) {
        skipped += 1;
        return;
      }

      failed += 1;
      errors.push(`${seed.ticker}: HTTP ${response.status} - ${text.slice(0, 120)}`);
    } catch (error) {
      failed += 1;
      errors.push(`${seed.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const { companies } = result;
  console.log(`[import] Starting import of ${companies.length} companies in batches of ${BATCH_SIZE}...`);

  for (let index = 0; index < companies.length; index += BATCH_SIZE) {
    const batch = companies.slice(index, index + BATCH_SIZE);
    await Promise.all(batch.map(createCompany));

    const progress = Math.min(index + BATCH_SIZE, companies.length);
    if (progress % 100 === 0 || progress === companies.length) {
      console.log(
        `[import] Progress: ${progress}/${companies.length} - created: ${created}, skipped: ${skipped}, failed: ${failed}`
      );
    }
  }

  console.log("\n=== Import Complete ===");
  console.log(`Total parsed:  ${companies.length}`);
  console.log(`Created:       ${created}`);
  console.log(`Skipped:       ${skipped}`);
  console.log(`Failed:        ${failed}`);

  if (errors.length > 0) {
    console.log("\nFirst 20 errors:");
    errors.slice(0, 20).forEach((entry) => console.log(`  ${entry}`));
  }
}

main().catch((error) => {
  console.error("[import] Fatal:", error);
  process.exit(1);
});
