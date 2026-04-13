import type {
  CompanySeed,
  ImportWarning,
  RelationEdge,
  ThemeKeyword
} from "./types.js";

/** Extract ticker and displayName from filename like "2330_台積電.md" */
function parseFilename(filename: string) {
  const match = filename.match(/^(\d{4})_(.+)\.md$/);
  if (!match) return null;
  return { ticker: match[1], displayName: match[2] };
}

/** Extract sector from path like "Pilot_Reports/Semiconductors/2330_台積電.md" */
function parseSector(relativePath: string): string | undefined {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  // Expected: Pilot_Reports/{Sector}/{file}.md
  const idx = parts.indexOf("Pilot_Reports");
  if (idx >= 0 && parts.length > idx + 2) {
    return parts[idx + 1];
  }
  return undefined;
}

/** Extract all [[wikilinks]] from text, tolerant of encoding noise */
function extractWikilinks(text: string): string[] {
  const matches = text.matchAll(/\[\[([^\]]+)\]\]/g);
  const result = new Set<string>();
  for (const m of matches) {
    const label = m[1].trim();
    if (label.length > 0 && label.length < 100) {
      result.add(label);
    }
  }
  return [...result];
}

/** Extract metadata fields from the 業務簡介 section */
function parseMetadata(text: string) {
  const sector = text.match(/\*\*板塊:\*\*\s*(.+)/)?.[1]?.trim();
  const industry = text.match(/\*\*產業:\*\*\s*(.+)/)?.[1]?.trim();
  const marketCap = text.match(/\*\*市值:\*\*\s*(.+)/)?.[1]?.trim();
  const enterpriseValue = text.match(/\*\*企業價值:\*\*\s*(.+)/)?.[1]?.trim();
  return { sector, industry, marketCap, enterpriseValue };
}

/** Extract summary text from 業務簡介 section (paragraphs after metadata) */
function parseSummary(text: string): string | undefined {
  const sectionMatch = text.match(/## 業務簡介\n([\s\S]*?)(?=\n## |$)/);
  if (!sectionMatch) return undefined;

  const sectionText = sectionMatch[1];
  const lines = sectionText.split("\n");
  const summaryLines: string[] = [];

  for (const line of lines) {
    // Skip metadata lines
    if (line.startsWith("**板塊:") || line.startsWith("**產業:") ||
        line.startsWith("**市值:") || line.startsWith("**企業價值:") ||
        line.trim() === "") {
      continue;
    }
    summaryLines.push(line);
  }

  const summary = summaryLines.join("\n").trim();
  return summary.length > 0 ? summary : undefined;
}

/** Classify wikilink relation based on section context */
function classifyRelation(
  sectionHeader: string
): RelationEdge["relationType"] {
  const h = sectionHeader.toLowerCase();
  if (h.includes("上游") || h.includes("供應商") || h.includes("supplier")) {
    return "supplier";
  }
  if (h.includes("下游") || h.includes("客戶") || h.includes("customer")) {
    return "customer";
  }
  if (h.includes("技術") || h.includes("technology")) {
    return "technology";
  }
  if (h.includes("應用") || h.includes("application")) {
    return "application";
  }
  return "unknown";
}

/** Check if text contains encoding noise patterns */
function hasEncodingNoise(text: string): boolean {
  // Common mojibake patterns from BIG5/UTF-8 mismatch
  return /[\ufffd]|[锟斤拷]|[\u0080-\u009f]{3,}/.test(text);
}

export type ReportParseResult = {
  company: CompanySeed;
  relations: RelationEdge[];
  themeKeywords: ThemeKeyword[];
  warnings: ImportWarning[];
};

/**
 * Parse a single My-TW-Coverage markdown report into structured records.
 *
 * @param content - raw file content
 * @param relativePath - path relative to My-TW-Coverage root, e.g. "Pilot_Reports/Semiconductors/2330_台積電.md"
 */
export function parseReport(
  content: string,
  relativePath: string
): ReportParseResult | null {
  const warnings: ImportWarning[] = [];
  const relations: RelationEdge[] = [];
  const themeKeywords: ThemeKeyword[] = [];

  // Extract filename from path
  const filename = relativePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const identity = parseFilename(filename);

  if (!identity) {
    warnings.push({
      code: "missing_header",
      message: `Could not parse ticker/name from filename: ${filename}`,
      sourcePath: relativePath
    });
    return null;
  }

  // Check for encoding noise
  if (hasEncodingNoise(content)) {
    warnings.push({
      code: "encoding_noise",
      message: "File contains encoding anomalies",
      sourcePath: relativePath
    });
  }

  // Parse metadata
  const metadata = parseMetadata(content);
  const sectorFromPath = parseSector(relativePath);
  const summary = parseSummary(content);

  const company: CompanySeed = {
    ticker: identity.ticker,
    displayName: identity.displayName,
    sector: sectorFromPath ?? metadata.sector,
    industry: metadata.industry,
    summary,
    marketCap: metadata.marketCap,
    enterpriseValue: metadata.enterpriseValue,
    sourcePath: relativePath
  };

  // Check for missing sections
  if (!content.includes("## 業務簡介")) {
    warnings.push({
      code: "missing_section",
      message: "Missing 業務簡介 section",
      sourcePath: relativePath
    });
  }

  if (!content.includes("## 供應鏈位置")) {
    warnings.push({
      code: "missing_section",
      message: "Missing 供應鏈位置 section",
      sourcePath: relativePath
    });
  }

  // Extract wikilinks from supply chain and customer sections for relations
  const supplyChainMatch = content.match(
    /## 供應鏈位置\n([\s\S]*?)(?=\n## |$)/
  );
  if (supplyChainMatch) {
    const sectionText = supplyChainMatch[1];
    // Split by sub-headers (lines starting with **)
    const blocks = sectionText.split(/\n(?=\*\*)/);

    for (const block of blocks) {
      const headerMatch = block.match(/^\*\*(.+?)\*\*/);
      const header = headerMatch?.[1] ?? "";
      const relationType = classifyRelation(header);
      const links = extractWikilinks(block);

      for (const link of links) {
        relations.push({
          fromLabel: identity.displayName,
          toLabel: link,
          relationType,
          confidence: 0.8,
          sourcePath: relativePath
        });
      }
    }
  }

  // Extract customer/supplier relations
  const customerMatch = content.match(
    /## 主要客戶及供應商\n([\s\S]*?)(?=\n## |$)/
  );
  if (customerMatch) {
    const sectionText = customerMatch[1];
    const customerSection = sectionText.match(
      /### 主要客戶\n([\s\S]*?)(?=\n### |$)/
    );
    const supplierSection = sectionText.match(
      /### 主要供應商\n([\s\S]*?)(?=\n### |$)/
    );

    if (customerSection) {
      for (const link of extractWikilinks(customerSection[1])) {
        relations.push({
          fromLabel: identity.displayName,
          toLabel: link,
          relationType: "customer",
          confidence: 0.9,
          sourcePath: relativePath
        });
      }
    }

    if (supplierSection) {
      for (const link of extractWikilinks(supplierSection[1])) {
        relations.push({
          fromLabel: identity.displayName,
          toLabel: link,
          relationType: "supplier",
          confidence: 0.9,
          sourcePath: relativePath
        });
      }
    }
  }

  // Extract all wikilinks as theme keywords (technologies, not company names)
  const allLinks = extractWikilinks(content);
  const technologyPatterns = /^[A-Z0-9]|晶|光|矽|碳|氮|磷|載板|衛星|伺服器|電動車/;
  for (const link of allLinks) {
    if (technologyPatterns.test(link)) {
      themeKeywords.push({
        label: link,
        sourcePath: relativePath,
        confidence: 0.6
      });
    }
  }

  return { company, relations, themeKeywords, warnings };
}
