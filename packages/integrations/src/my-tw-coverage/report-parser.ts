import type {
  CompanySeed,
  ImportWarning,
  RelationEdge,
  ThemeKeyword
} from "./types.js";

type ParsedSection = {
  level: 2 | 3;
  title: string;
  parentTitle?: string;
  lines: string[];
};

const BUSINESS_INTRO_HEADERS = ["業務簡介", "公司簡介", "營運概況"];
const SUPPLY_CHAIN_HEADERS = ["供應鏈位置", "供應鏈", "產業鏈位置"];
const CUSTOMER_SUPPLIER_HEADERS = ["主要客戶及供應商", "主要客戶與供應商"];

const METADATA_LABELS = {
  sector: ["板塊", "板块", "sector"],
  industry: ["產業", "产业", "industry"],
  marketCap: ["市值", "marketcap", "market cap"],
  enterpriseValue: ["企業價值", "企业价值", "enterprisevalue", "enterprise value"]
} as const;

function parseFilename(filename: string) {
  const match = filename.match(/^(\d{4})_(.+)\.md$/u);
  if (!match) {
    return null;
  }

  return {
    ticker: match[1],
    displayName: match[2]
  };
}

function parseSector(relativePath: string): string | undefined {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  const reportsIndex = parts.indexOf("Pilot_Reports");

  if (reportsIndex >= 0 && parts.length > reportsIndex + 2) {
    return parts[reportsIndex + 1];
  }

  return undefined;
}

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_:#：()\[\]（）/\\,\-.、\s]/gu, "");
}

function matchesHeader(title: string, candidates: readonly string[]): boolean {
  const normalizedTitle = normalizeHeading(title);
  return candidates.some((candidate) =>
    normalizedTitle.includes(normalizeHeading(candidate))
  );
}

function splitSections(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = text.split(/\r?\n/u);
  let current: ParsedSection | null = null;
  let currentLevel2Title: string | undefined;

  for (const line of lines) {
    const headingMatch = line.match(/^(##|###)\s+(.+)$/u);
    if (headingMatch) {
      const level = headingMatch[1] === "###" ? 3 : 2;
      const title = headingMatch[2].trim();

      current = {
        level,
        title,
        parentTitle: level === 3 ? currentLevel2Title : undefined,
        lines: []
      };

      if (level === 2) {
        currentLevel2Title = title;
      }

      sections.push(current);
      continue;
    }

    current?.lines.push(line);
  }

  return sections;
}

function extractWikilinks(text: string): string[] {
  const result = new Set<string>();
  const matches = text.matchAll(/\[\[([^\]]+)\]\]/gu);

  for (const match of matches) {
    const label = match[1].trim();
    if (label && label.length < 120) {
      result.add(label);
    }
  }

  return [...result];
}

function stripMetadataLabel(label: string): string {
  return label.replace(/[*:：\s]/gu, "").trim();
}

function parseMetadata(lines: string[]) {
  const metadata = {
    sector: undefined as string | undefined,
    industry: undefined as string | undefined,
    marketCap: undefined as string | undefined,
    enterpriseValue: undefined as string | undefined
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("**")) {
      continue;
    }

    const metadataMatch = line.match(/^\*\*(.+?)\*\*\s*(.+)?$/u);
    if (!metadataMatch) {
      continue;
    }

    const label = stripMetadataLabel(metadataMatch[1]);
    const value = (metadataMatch[2] ?? "").trim();
    const normalizedLabel = normalizeHeading(label);

    if (!value) {
      continue;
    }

    if (METADATA_LABELS.sector.some((item) => normalizedLabel === normalizeHeading(item))) {
      metadata.sector = value;
      continue;
    }

    if (METADATA_LABELS.industry.some((item) => normalizedLabel === normalizeHeading(item))) {
      metadata.industry = value;
      continue;
    }

    if (METADATA_LABELS.marketCap.some((item) => normalizedLabel === normalizeHeading(item))) {
      metadata.marketCap = value;
      continue;
    }

    if (
      METADATA_LABELS.enterpriseValue.some(
        (item) => normalizedLabel === normalizeHeading(item)
      )
    ) {
      metadata.enterpriseValue = value;
    }
  }

  return metadata;
}

function parseSummary(section: ParsedSection | undefined): string | undefined {
  if (!section) {
    return undefined;
  }

  const summaryLines = section.lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("**"))
    .filter((line) => !line.startsWith("|"))
    .filter((line) => !line.startsWith("###"));

  if (summaryLines.length === 0) {
    return undefined;
  }

  return summaryLines.join("\n");
}

function classifyRelation(
  sectionTitle: string,
  subsectionTitle: string | undefined,
  lineContext: string
): RelationEdge["relationType"] {
  const context = normalizeHeading(`${sectionTitle} ${subsectionTitle ?? ""} ${lineContext}`);

  if (
    context.includes(normalizeHeading("主要客戶")) ||
    context.includes(normalizeHeading("客戶")) ||
    context.includes(normalizeHeading("ai/hpc")) ||
    context.includes(normalizeHeading("超級大客戶"))
  ) {
    return "customer";
  }

  if (
    context.includes(normalizeHeading("主要供應商")) ||
    context.includes(normalizeHeading("供應商")) ||
    context.includes(normalizeHeading("上游")) ||
    context.includes(normalizeHeading("設備")) ||
    context.includes(normalizeHeading("材料")) ||
    context.includes(normalizeHeading("原料")) ||
    context.includes(normalizeHeading("ipeda"))
  ) {
    return "supplier";
  }

  if (
    context.includes(normalizeHeading("下游應用")) ||
    context.includes(normalizeHeading("主要平台")) ||
    context.includes(normalizeHeading("終端產品")) ||
    context.includes(normalizeHeading("應用"))
  ) {
    return "application";
  }

  if (
    context.includes(normalizeHeading("技術")) ||
    context.includes(normalizeHeading("製程")) ||
    context.includes(normalizeHeading("technology"))
  ) {
    return "technology";
  }

  return "unknown";
}

function hasEncodingNoise(text: string): boolean {
  return /�|ï¿½|�|[\u0080-\u009f]{2,}/u.test(text);
}

function uniqueRelations(relations: RelationEdge[]) {
  const deduped = new Map<string, RelationEdge>();

  for (const relation of relations) {
    const key = [
      relation.fromLabel,
      relation.toLabel,
      relation.relationType
    ].join("::");

    if (!deduped.has(key)) {
      deduped.set(key, relation);
    }
  }

  return [...deduped.values()];
}

function buildThemeKeywords(
  content: string,
  displayName: string,
  relations: RelationEdge[],
  sourcePath: string
): ThemeKeyword[] {
  const relatedCompanyLabels = new Set(relations.map((relation) => relation.toLabel));
  const keywords = new Map<string, ThemeKeyword>();

  for (const label of extractWikilinks(content)) {
    if (label === displayName) {
      continue;
    }

    const looksLikeTheme =
      !relatedCompanyLabels.has(label) ||
      /[A-Z]{2,}|\d+奈米|AI|GPU|CPU|EUV|HPC|矽|EDA|光/u.test(label);

    if (!looksLikeTheme) {
      continue;
    }

    keywords.set(label, {
      label,
      sourcePath,
      confidence: 0.6
    });
  }

  return [...keywords.values()];
}

export type ReportParseResult = {
  company: CompanySeed;
  relations: RelationEdge[];
  themeKeywords: ThemeKeyword[];
  warnings: ImportWarning[];
};

export function parseReport(
  content: string,
  relativePath: string
): ReportParseResult | null {
  const warnings: ImportWarning[] = [];
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

  if (hasEncodingNoise(content)) {
    warnings.push({
      code: "encoding_noise",
      message: "Detected encoding noise in report content",
      sourcePath: relativePath
    });
  }

  const sections = splitSections(content);
  const introSection = sections.find((section) =>
    section.level === 2 && matchesHeader(section.title, BUSINESS_INTRO_HEADERS)
  );
  const supplyChainSections = sections.filter((section) =>
    matchesHeader(section.title, SUPPLY_CHAIN_HEADERS) ||
    matchesHeader(section.title, CUSTOMER_SUPPLIER_HEADERS) ||
    matchesHeader(section.parentTitle ?? "", SUPPLY_CHAIN_HEADERS) ||
    matchesHeader(section.parentTitle ?? "", CUSTOMER_SUPPLIER_HEADERS)
  );

  const metadata = parseMetadata(introSection?.lines ?? []);
  const company: CompanySeed = {
    ticker: identity.ticker,
    displayName: identity.displayName,
    sector: parseSector(relativePath) ?? metadata.sector,
    industry: metadata.industry,
    summary: parseSummary(introSection),
    marketCap: metadata.marketCap,
    enterpriseValue: metadata.enterpriseValue,
    sourcePath: relativePath
  };

  if (!introSection) {
    warnings.push({
      code: "missing_section",
      message: "Missing 業務簡介 section",
      sourcePath: relativePath
    });
  }

  if (supplyChainSections.length === 0) {
    warnings.push({
      code: "missing_section",
      message: "Missing 供應鏈/客戶供應商 sections",
      sourcePath: relativePath
    });
  }

  const relations: RelationEdge[] = [];

  for (const section of supplyChainSections) {
    let currentSubsection: string | undefined =
      section.level === 3 ? section.title : undefined;

    for (const rawLine of section.lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const subsectionMatch = line.match(/^###\s+(.+)$/u);
      if (subsectionMatch) {
        currentSubsection = subsectionMatch[1].trim();
        continue;
      }

      const links = extractWikilinks(line).filter((label) => label !== identity.displayName);
      if (links.length === 0) {
        continue;
      }

      const lineContextMatch = line.match(/^-?\s*\*\*(.+?)\*\*/u);
      const lineContext = lineContextMatch?.[1] ?? line;
      const relationType = classifyRelation(
        section.parentTitle ?? section.title,
        currentSubsection,
        lineContext
      );

      for (const link of links) {
        relations.push({
          fromLabel: identity.displayName,
          toLabel: link,
          relationType,
          confidence:
            relationType === "customer" || relationType === "supplier" ? 0.9 : 0.7,
          sourcePath: relativePath
        });
      }
    }
  }

  return {
    company,
    relations: uniqueRelations(relations),
    themeKeywords: buildThemeKeywords(
      content,
      identity.displayName,
      relations,
      relativePath
    ),
    warnings
  };
}
