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

import { runImport } from "../packages/integrations/src/my-tw-coverage/importer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const API_URL = process.env.API_URL ?? "https://api-production-8f08.up.railway.app";
const COVERAGE_PATH =
  process.env.COVERAGE_PATH ?? path.resolve(repoRoot, "..", "My-TW-Coverage");
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? "primary-desk";
const APPLY = process.env.APPLY !== "false";
const BATCH_SIZE = 10;

const headers = {
  "Content-Type": "application/json",
  "x-workspace-slug": WORKSPACE_SLUG
};

type CompanyGraphSyncItem = {
  company: Company;
  relations: CompanyRelationInput[];
  keywords: CompanyKeywordInput[];
};

function normalizeLabel(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
}

function dedupeRelations(relations: CompanyRelationInput[]) {
  const deduped = new Map<string, CompanyRelationInput>();

  for (const relation of relations) {
    const key = [
      relation.targetLabel,
      relation.relationType
    ]
      .map((part) => normalizeLabel(part))
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
    const key = normalizeLabel(keyword.label);
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
  const response = await fetch(`${API_URL}/api/v1/companies`, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch companies: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data: Company[] };
  return payload.data;
}

async function replaceCompanyRelations(companyId: string, relations: CompanyRelationInput[]) {
  const response = await fetch(`${API_URL}/api/v1/companies/${companyId}/relations`, {
    method: "PUT",
    headers,
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
    headers,
    body: JSON.stringify({ keywords })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`keywords HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
}

async function main() {
  console.log(`[graph-sync] Parsing coverage at: ${COVERAGE_PATH}`);
  const imported = runImport({ coveragePath: COVERAGE_PATH });
  console.log(
    `[graph-sync] Parsed ${imported.companies.length} companies, ${imported.relations.length} relations, ${imported.companyKeywords.length} company keywords`
  );

  const existingCompanies = await fetchCompanies();
  const companyByTicker = new Map(
    existingCompanies
      .filter((company) => company.ticker)
      .map((company) => [company.ticker, company] as const)
  );
  const companyByName = new Map(
    existingCompanies.map((company) => [normalizeLabel(company.name), company] as const)
  );

  const ownedCompanyByLabel = new Map<string, Company>();
  for (const seed of imported.companies) {
    const company =
      companyByTicker.get(seed.ticker) ??
      companyByName.get(normalizeLabel(seed.displayName));

    if (company) {
      ownedCompanyByLabel.set(normalizeLabel(seed.displayName), company);
    }
  }

  const relationsBySource = new Map<string, CompanyRelationInput[]>();
  for (const relation of imported.relations) {
    const sourceCompany = ownedCompanyByLabel.get(normalizeLabel(relation.fromLabel));
    if (!sourceCompany) {
      continue;
    }

    const targetCompany =
      companyByName.get(normalizeLabel(relation.toLabel)) ??
      ownedCompanyByLabel.get(normalizeLabel(relation.toLabel));

    const current = relationsBySource.get(sourceCompany.id) ?? [];
    current.push({
      targetCompanyId: targetCompany?.id ?? null,
      targetLabel: relation.toLabel,
      relationType: relation.relationType,
      confidence: relation.confidence,
      sourcePath: relation.sourcePath
    });
    relationsBySource.set(sourceCompany.id, current);
  }

  const keywordsBySource = new Map<string, CompanyKeywordInput[]>();
  for (const keyword of imported.companyKeywords) {
    const company = ownedCompanyByLabel.get(normalizeLabel(keyword.companyLabel));
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
