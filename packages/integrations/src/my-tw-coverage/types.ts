export type CoverageSourceArtifact = {
  sourcePath: string;
  sourceType: "report" | "graph" | "wikilink_index" | "theme_page";
  checksum?: string;
};

export type CompanySeed = {
  ticker: string;
  displayName: string;
  sector?: string;
  industry?: string;
  summary?: string;
  marketCap?: string;
  enterpriseValue?: string;
  sourcePath: string;
};

export type RelationEdge = {
  fromLabel: string;
  toLabel: string;
  relationType:
    | "supplier"
    | "customer"
    | "technology"
    | "application"
    | "co_occurrence"
    | "unknown";
  confidence: number;
  sourcePath: string;
};

export type ThemeKeyword = {
  label: string;
  sourcePath: string;
  confidence: number;
};

export type ImportWarning = {
  code:
    | "encoding_noise"
    | "missing_header"
    | "unresolved_wikilink"
    | "table_parse_failed"
    | "duplicate_alias"
    | "missing_section";
  message: string;
  sourcePath: string;
};

export type ImportResult = {
  companies: CompanySeed[];
  relations: RelationEdge[];
  themeKeywords: ThemeKeyword[];
  warnings: ImportWarning[];
  sources: CoverageSourceArtifact[];
};
