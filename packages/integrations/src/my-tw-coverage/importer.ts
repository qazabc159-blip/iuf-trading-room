import fs from "node:fs";
import path from "node:path";

import type { CompanyCreateInput } from "@iuf-trading-room/contracts";

import { parseGraphData } from "./graph-parser.js";
import { parseReport } from "./report-parser.js";
import type {
  CoverageSourceArtifact,
  CompanyKeywordSeed,
  CompanySeed,
  ImportResult,
  ImportWarning,
  RelationEdge,
  ThemeKeyword
} from "./types.js";

/** Recursively find all .md files under a directory */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

export type ImportOptions = {
  /** Absolute path to the My-TW-Coverage root directory */
  coveragePath: string;
  /** Whether to include graph_data.json parsing (default: true) */
  includeGraph?: boolean;
};

function toPlainText(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\r\n/gu, "\n")
    .trim();
}

export function buildImportedCompanyNotes(seed: CompanySeed): string {
  const lines = [
    toPlainText(seed.summary),
    seed.sector ? `Sector: ${seed.sector}` : "",
    seed.industry ? `Industry: ${seed.industry}` : "",
    seed.marketCap ? `Market Cap: ${seed.marketCap}` : "",
    seed.enterpriseValue ? `Enterprise Value: ${seed.enterpriseValue}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return lines.slice(0, 1500) || "Imported from My-TW-Coverage";
}

export function buildImportedCompanyDraft(seed: CompanySeed): CompanyCreateInput {
  return {
    name: seed.displayName,
    ticker: seed.ticker,
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: seed.industry ?? seed.sector ?? "Unknown",
    beneficiaryTier: "Observation",
    exposure: {
      volume: 1,
      asp: 1,
      margin: 1,
      capacity: 1,
      narrative: 1
    },
    validation: {
      capitalFlow: "N/A",
      consensus: "N/A",
      relativeStrength: "N/A"
    },
    notes: buildImportedCompanyNotes(seed)
  };
}

/**
 * Run the full My-TW-Coverage import pipeline.
 * Returns a preview of all extracted data without writing to DB.
 */
export function runImport(options: ImportOptions): ImportResult {
  const { coveragePath, includeGraph = true } = options;

  const companies: CompanySeed[] = [];
  const relations: RelationEdge[] = [];
  const themeKeywords: ThemeKeyword[] = [];
  const companyKeywords: CompanyKeywordSeed[] = [];
  const warnings: ImportWarning[] = [];
  const sources: CoverageSourceArtifact[] = [];

  // 1. Parse Pilot_Reports
  const reportsDir = path.join(coveragePath, "Pilot_Reports");
  if (fs.existsSync(reportsDir)) {
    const mdFiles = findMarkdownFiles(reportsDir);

    for (const filePath of mdFiles) {
      const relativePath = path.relative(coveragePath, filePath).replace(/\\/g, "/");

      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        warnings.push({
          code: "encoding_noise",
          message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
          sourcePath: relativePath
        });
        continue;
      }

      sources.push({
        sourcePath: relativePath,
        sourceType: "report"
      });

      const result = parseReport(content, relativePath);
      if (result) {
        companies.push(result.company);
        relations.push(...result.relations);
        themeKeywords.push(...result.themeKeywords);
        companyKeywords.push(
          ...result.themeKeywords.map((keyword) => ({
            companyLabel: result.company.displayName,
            label: keyword.label,
            sourcePath: keyword.sourcePath,
            confidence: keyword.confidence
          }))
        );
        warnings.push(...result.warnings);
      }
    }
  } else {
    warnings.push({
      code: "missing_section",
      message: "Pilot_Reports directory not found",
      sourcePath: coveragePath
    });
  }

  // 2. Parse graph_data.json
  if (includeGraph) {
    const graphPath = path.join(coveragePath, "network", "graph_data.json");
    if (fs.existsSync(graphPath)) {
      try {
        const graphContent = fs.readFileSync(graphPath, "utf-8");
        const graphResult = parseGraphData(graphContent, "network/graph_data.json");

        sources.push({
          sourcePath: "network/graph_data.json",
          sourceType: "graph"
        });

        // Only add companies from graph that aren't already in reports
        const existingNames = new Set(companies.map((c) => c.displayName));
        for (const seed of graphResult.companies) {
          if (!existingNames.has(seed.displayName)) {
            companies.push(seed);
          }
        }

        relations.push(...graphResult.relations);
      } catch (err) {
        warnings.push({
          code: "table_parse_failed",
          message: `Failed to parse graph_data.json: ${err instanceof Error ? err.message : String(err)}`,
          sourcePath: "network/graph_data.json"
        });
      }
    }
  }

  // 3. Deduplicate theme keywords
  const keywordMap = new Map<string, ThemeKeyword>();
  for (const kw of themeKeywords) {
    const existing = keywordMap.get(kw.label);
    if (!existing || kw.confidence > existing.confidence) {
      keywordMap.set(kw.label, kw);
    }
  }

  const companyKeywordMap = new Map<string, CompanyKeywordSeed>();
  for (const keyword of companyKeywords) {
    const key = `${keyword.companyLabel}::${keyword.label}`;
    const existing = companyKeywordMap.get(key);
    if (!existing || keyword.confidence > existing.confidence) {
      companyKeywordMap.set(key, keyword);
    }
  }

  return {
    companies,
    relations,
    themeKeywords: [...keywordMap.values()],
    companyKeywords: [...companyKeywordMap.values()],
    warnings,
    sources
  };
}
