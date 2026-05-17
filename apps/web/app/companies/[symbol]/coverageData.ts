export interface SupplyChainGroup {
  category: string;
  companies: string[];
}

export interface CoverageBrief {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: string;
  enterpriseValue: string;
  businessOverview: string;
  supplyChain: {
    upstream: SupplyChainGroup[];
    midstream: SupplyChainGroup[];
    downstream: SupplyChainGroup[];
  };
  majorCustomers: string[];
  majorSuppliers: string[];
  wikilinks?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function normalizeGroups(value: unknown): SupplyChainGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      category: textValue(item.category) || "未分類",
      companies: textArray(item.companies),
    }))
    .filter((item) => item.companies.length > 0);
}

function normalizeSupplyChain(value: unknown): CoverageBrief["supplyChain"] {
  const record = isRecord(value) ? value : {};
  return {
    upstream: normalizeGroups(record.upstream),
    midstream: normalizeGroups(record.midstream),
    downstream: normalizeGroups(record.downstream),
  };
}

export function normalizeCoverageBrief(raw: unknown, fallbackTicker = ""): CoverageBrief {
  const record = isRecord(raw) ? raw : {};
  const industries = textArray(record.industries);
  const wikilinks = textArray(record.wikilinks);
  const ticker = textValue(record.ticker) || fallbackTicker;

  return {
    ticker,
    companyName: textValue(record.companyName) || textValue(record.name) || ticker,
    sector: textValue(record.sector) || industries[0] || "",
    industry: textValue(record.industry) || industries[1] || industries[0] || "",
    marketCap: textValue(record.marketCap),
    enterpriseValue: textValue(record.enterpriseValue),
    businessOverview: textValue(record.businessOverview) || textValue(record.summary),
    supplyChain: normalizeSupplyChain(record.supplyChain),
    majorCustomers: textArray(record.majorCustomers),
    majorSuppliers: textArray(record.majorSuppliers),
    wikilinks: wikilinks.length > 0 ? wikilinks : [...textArray(record.themes), ...textArray(record.keywords)],
  };
}
