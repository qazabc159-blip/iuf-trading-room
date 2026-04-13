import fs from "node:fs";
import path from "node:path";

import { parseGraphData } from "./graph-parser.js";
import { parseReport } from "./report-parser.js";
import type {
  CoverageSourceArtifact,
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

/**
 * Run the full My-TW-Coverage import pipeline.
 * Returns a preview of all extracted data without writing to DB.
 */
export function runImport(options: ImportOptions): ImportResult {
  const { coveragePath, includeGraph = true } = options;

  const companies: CompanySeed[] = [];
  const relations: RelationEdge[] = [];
  const themeKeywords: ThemeKeyword[] = [];
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

  return {
    companies,
    relations,
    themeKeywords: [...keywordMap.values()],
    warnings,
    sources
  };
}
