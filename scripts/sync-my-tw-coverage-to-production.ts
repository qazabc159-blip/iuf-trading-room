/**
 * Sync imported My-TW-Coverage metadata into the production API without
 * clobbering manually curated company notes.
 *
 * Usage:
 *   node --import tsx ./scripts/sync-my-tw-coverage-to-production.ts
 *
 * Env:
 *   API_URL - production API base
 *   COVERAGE_PATH - path to the My-TW-Coverage repo root
 *   WORKSPACE_SLUG - workspace slug to update
 *   APPLY - set to "false" for a dry run
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Company } from "@iuf-trading-room/contracts";

import {
  buildImportedCompanyDraft,
  runImport
} from "../packages/integrations/src/my-tw-coverage/importer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const API_URL = process.env.API_URL ?? "https://api-production-8f08.up.railway.app";
const COVERAGE_PATH =
  process.env.COVERAGE_PATH ?? path.resolve(repoRoot, "..", "My-TW-Coverage");
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? "primary-desk";
const APPLY = process.env.APPLY !== "false";
const BATCH_SIZE = 10;
const OWNER_EMAIL = process.env.OWNER_EMAIL;
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;

let sessionCookie = "";

async function login(): Promise<void> {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    throw new Error("OWNER_EMAIL and OWNER_PASSWORD must be set");
  }
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
  });
  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status}`);
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/iuf_session=[^;]+/);
  if (!match) {
    throw new Error(`Login response missing iuf_session cookie: ${setCookie.slice(0, 200)}`);
  }
  sessionCookie = match[0];
  console.log(`[sync] Logged in as ${OWNER_EMAIL}`);
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-workspace-slug": WORKSPACE_SLUG,
    Cookie: sessionCookie
  };
}

const headers = {
  "Content-Type": "application/json",
  "x-workspace-slug": WORKSPACE_SLUG
};

function shouldRefreshNotes(currentNotes: string, desiredNotes: string): boolean {
  const trimmed = currentNotes.trim();

  if (!trimmed) {
    return true;
  }

  if (
    trimmed === "Imported from My-TW-Coverage" ||
    trimmed.startsWith("Sector: ") ||
    trimmed.startsWith("Industry: ")
  ) {
    return true;
  }

  if (trimmed.length < 80 && desiredNotes.length > trimmed.length * 2) {
    return true;
  }

  return false;
}

function buildCompanyPatch(existing: Company, desired: ReturnType<typeof buildImportedCompanyDraft>) {
  const patch: Partial<typeof desired> = {};

  if (existing.name !== desired.name) {
    patch.name = desired.name;
  }

  if (existing.chainPosition !== desired.chainPosition) {
    patch.chainPosition = desired.chainPosition;
  }

  if (shouldRefreshNotes(existing.notes, desired.notes)) {
    patch.notes = desired.notes;
  }

  return patch;
}

async function fetchCompanies(): Promise<Company[]> {
  const response = await fetch(`${API_URL}/api/v1/companies`, {
    headers: authHeaders()
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch companies: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data: Company[] };
  return payload.data;
}

async function patchCompany(companyId: string, patch: Record<string, unknown>) {
  const response = await fetch(`${API_URL}/api/v1/companies/${companyId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

async function main() {
  await login();
  console.log(`[sync] Parsing coverage at: ${COVERAGE_PATH}`);
  const imported = runImport({ coveragePath: COVERAGE_PATH });
  console.log(
    `[sync] Parsed ${imported.companies.length} companies, ${imported.relations.length} relations, ${imported.themeKeywords.length} keywords`
  );

  const existingCompanies = await fetchCompanies();
  const existingByTicker = new Map(
    existingCompanies
      .filter((company) => company.market === "TWSE" && company.ticker)
      .map((company) => [company.ticker, company])
  );

  const plannedUpdates: Array<{
    companyId: string;
    ticker: string;
    name: string;
    patch: Record<string, unknown>;
  }> = [];

  for (const seed of imported.companies) {
    const existing = existingByTicker.get(seed.ticker);
    if (!existing) {
      continue;
    }

    const desired = buildImportedCompanyDraft(seed);
    const patch = buildCompanyPatch(existing, desired);
    if (Object.keys(patch).length === 0) {
      continue;
    }

    plannedUpdates.push({
      companyId: existing.id,
      ticker: existing.ticker,
      name: desired.name,
      patch
    });
  }

  console.log(
    `[sync] ${plannedUpdates.length} companies need metadata refresh (${APPLY ? "apply" : "dry-run"} mode)`
  );

  if (!APPLY || plannedUpdates.length === 0) {
    console.log(
      JSON.stringify(
        plannedUpdates.slice(0, 20).map((item) => ({
          ticker: item.ticker,
          name: item.name,
          fields: Object.keys(item.patch)
        })),
        null,
        2
      )
    );
    return;
  }

  let updated = 0;
  const errors: string[] = [];

  for (let index = 0; index < plannedUpdates.length; index += BATCH_SIZE) {
    const batch = plannedUpdates.slice(index, index + BATCH_SIZE);
    await Promise.all(
      batch.map(async (item) => {
        try {
          await patchCompany(item.companyId, item.patch);
          updated += 1;
        } catch (error) {
          errors.push(
            `${item.ticker} ${item.name}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })
    );

    const progress = Math.min(index + BATCH_SIZE, plannedUpdates.length);
    console.log(`[sync] Progress ${progress}/${plannedUpdates.length} updated=${updated}`);
  }

  console.log("\n=== Sync Complete ===");
  console.log(`Existing companies: ${existingCompanies.length}`);
  console.log(`Updated:            ${updated}`);
  console.log(`Failed:             ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nFirst 20 errors:");
    errors.slice(0, 20).forEach((entry) => console.log(`  ${entry}`));
  }
}

main().catch((error) => {
  console.error("[sync] Fatal:", error);
  process.exit(1);
});
