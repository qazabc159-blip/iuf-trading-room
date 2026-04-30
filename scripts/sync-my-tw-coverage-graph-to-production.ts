/**
 * Sync My-TW-Coverage relations + company keywords into the production API.
 *
 * Usage:
 *   node --import tsx ./scripts/sync-my-tw-coverage-graph-to-production.ts
 *
 * Env:
 *   API_URL - production API base
 *   COVERAGE_PATH - path to the My-TW-Coverage repo root
 *   WORKSPACE_SLUG - workspace slug to update
 *   APPLY - set to "false" for a dry run
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Company,
  CompanyKeywordInput,
  CompanyRelationInput
} from "@iuf-trading-room/contracts";

import {
  buildCompanyReferenceIndex,
  normalizeCompanyReferenceLabel,
  resolveCompanyReference,
  runImport
} from "../packages/integrations/src/my-tw-coverage/index.js";

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
    throw new Error(`Login response missing iuf_session cookie`);
  }
  sessionCookie = match[0];
  console.log(`[graph-sync] Logged in as ${OWNER_EMAIL}`);
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-workspace-slug": WORKSPACE_SLUG,
    Cookie: sessionCookie
  };
}

type CompanyGraphSyncItem = {
  company: Company;
  relations: CompanyRelationInput[];
  keywords: CompanyKeywordInput[];
};

function dedupeRelations(relations: CompanyRelationInput[]) {
  const deduped = new Map<string, CompanyRelationInput>();

  for (const relation of relations) {
    const key = [
      relation.targetLabel,
      relation.relationType
    ]
      .map((part) => normalizeCompanyReferenceLabel(part))
      .join("::");
    const existing = deduped.get(key);
    if (
      !existing ||
      relation.confidence > existing.confidence ||
      (relation.targetCompanyId && !existing.targetCompanyId)
    ) {
      deduped.set(key, relation);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    return left.targetLabel.localeCompare(right.targetLabel);
  });
}

function dedupeKeywords(keywords: CompanyKeywordInput[]) {
  const deduped = new Map<string, CompanyKeywordInput>();

  for (const keyword of keywords) {
    const key = normalizeCompanyReferenceLabel(keyword.label);
    const existing = deduped.get(key);
    if (!existing || keyword.confidence > existing.confidence) {
      deduped.set(key, keyword);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    return left.label.localeCompare(right.label);
  });
}

async function fetchCompanies(): Promise<Company[]> {
  const response = await fetch(`${API_URL}/api/v1/companies`, { headers: authHeaders() });

  if (!response.ok) {
    throw new Error(`Failed to fetch companies: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data: Company[] };
  return payload.data;
}

async function replaceCompanyRelations(companyId: string, relations: CompanyRelationInput[]) {
  const response = await fetch(`${API_URL}/api/v1/companies/${companyId}/relations`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ relations })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`relations HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
}

async function replaceCompanyKeywords(companyId: string, keywords: CompanyKeywordInput[]) {
  const response = await fetch(`${API_URL}/api/v1/companies/${companyId}/keywords`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ keywords })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`keywords HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
}

async function main() {
  await login();
  console.log(`[graph-sync] Parsing coverage at: ${COVERAGE_PATH}`);
  const imported = runImport({ coveragePath: COVERAGE_PATH });
  console.log(
    `[graph-sync] Parsed ${imported.companies.length} companies, ${imported.relations.length} relations, ${imported.companyKeywords.length} company keywords`
  );

  const existingCompanies = await fetchCompanies();
  const companyReferenceIndex = buildCompanyReferenceIndex(existingCompanies);

  const ownedCompanyByLabel = new Map<string, Company>();
  for (const seed of imported.companies) {
    const company =
      companyReferenceIndex.byTicker.get(seed.ticker) ??
      companyReferenceIndex.byExactName.get(normalizeCompanyReferenceLabel(seed.displayName)) ??
      null;

    if (company) {
      ownedCompanyByLabel.set(normalizeCompanyReferenceLabel(seed.displayName), company);
    }
  }

  const relationsBySource = new Map<string, CompanyRelationInput[]>();
  const relationStrategyCounts = new Map<string, number>();
  for (const relation of imported.relations) {
    const sourceCompany = ownedCompanyByLabel.get(normalizeCompanyReferenceLabel(relation.fromLabel));
    if (!sourceCompany) {
      continue;
    }

    const match =
      resolveCompanyReference(companyReferenceIndex, relation.toLabel) ??
      (() => {
        const ownedMatch = ownedCompanyByLabel.get(normalizeCompanyReferenceLabel(relation.toLabel));
        return ownedMatch ? { company: ownedMatch, strategy: "exact_name" as const } : null;
      })();

    if (match) {
      relationStrategyCounts.set(
        match.strategy,
        (relationStrategyCounts.get(match.strategy) ?? 0) + 1
      );
    }

    const current = relationsBySource.get(sourceCompany.id) ?? [];
    current.push({
      targetCompanyId: match?.company.id ?? null,
      targetLabel: relation.toLabel,
      relationType: relation.relationType,
      confidence: relation.confidence,
      sourcePath: relation.sourcePath
    });
    relationsBySource.set(sourceCompany.id, current);
  }

  const keywordsBySource = new Map<string, CompanyKeywordInput[]>();
  for (const keyword of imported.companyKeywords) {
    const company = ownedCompanyByLabel.get(normalizeCompanyReferenceLabel(keyword.companyLabel));
    if (!company) {
      continue;
    }

    const current = keywordsBySource.get(company.id) ?? [];
    current.push({
      label: keyword.label,
      confidence: keyword.confidence,
      sourcePath: keyword.sourcePath
    });
    keywordsBySource.set(company.id, current);
  }

  const planned: CompanyGraphSyncItem[] = existingCompanies
    .map((company) => ({
      company,
      relations: dedupeRelations(relationsBySource.get(company.id) ?? []),
      keywords: dedupeKeywords(keywordsBySource.get(company.id) ?? [])
    }))
    .filter((item) => item.relations.length > 0 || item.keywords.length > 0);

  console.log(
    `[graph-sync] ${planned.length} companies have graph payloads (${APPLY ? "apply" : "dry-run"} mode)`
  );
  console.log(
    `[graph-sync] relation resolution strategies: ${JSON.stringify(
      Object.fromEntries([...relationStrategyCounts.entries()].sort((left, right) =>
        left[0].localeCompare(right[0])
      ))
    )}`
  );

  if (!APPLY || planned.length === 0) {
    console.log(
      JSON.stringify(
        planned.slice(0, 10).map((item) => ({
          ticker: item.company.ticker,
          name: item.company.name,
          relations: item.relations.length,
          keywords: item.keywords.length
        })),
        null,
        2
      )
    );
    return;
  }

  let updatedCompanies = 0;
  let updatedRelations = 0;
  let updatedKeywords = 0;
  const errors: string[] = [];

  for (let index = 0; index < planned.length; index += BATCH_SIZE) {
    const batch = planned.slice(index, index + BATCH_SIZE);

    await Promise.all(
      batch.map(async (item) => {
        try {
          await replaceCompanyRelations(item.company.id, item.relations);
          await replaceCompanyKeywords(item.company.id, item.keywords);
          updatedCompanies += 1;
          updatedRelations += item.relations.length;
          updatedKeywords += item.keywords.length;
        } catch (error) {
          errors.push(
            `${item.company.ticker} ${item.company.name}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })
    );

    const progress = Math.min(index + BATCH_SIZE, planned.length);
    console.log(
      `[graph-sync] Progress ${progress}/${planned.length} companies=${updatedCompanies} relations=${updatedRelations} keywords=${updatedKeywords}`
    );
  }

  console.log("\n=== Graph Sync Complete ===");
  console.log(`Companies with payload: ${planned.length}`);
  console.log(`Updated companies:      ${updatedCompanies}`);
  console.log(`Relations synced:       ${updatedRelations}`);
  console.log(`Keywords synced:        ${updatedKeywords}`);
  console.log(`Failed:                 ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nFirst 20 errors:");
    errors.slice(0, 20).forEach((entry) => console.log(`  ${entry}`));
  }
}

main().catch((error) => {
  console.error("[graph-sync] Fatal:", error);
  process.exit(1);
});
