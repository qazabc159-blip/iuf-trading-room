import type { Company as ContractCompany } from "@iuf-trading-room/contracts";

export type SourceHealthState = "live" | "stale" | "error";

export type CompanyDetailQuote = {
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  asOf: string | null;
  source: "kgi" | "finmind" | null;
};

export type CompanyDetailView = {
  id: string;
  symbol: string;
  ticker: string;
  name: string;
  nameEn: string | null;
  market: string;
  country: string;
  listing: string;
  chainPosition: string;
  beneficiaryTier: string;
  themes: string[];
  scorePct: number | null;
  momentum: string;
  marketCapBn: number | null;
  intradayChgPct: number | null;
  fiiNetBn5d: number | null;
  notes: string;
  exposure: ContractCompany["exposure"];
  validation: ContractCompany["validation"];
};

export type SourceStatus = {
  id: string;
  label: string;
  state: SourceHealthState;
  summary: string;
  lastSeen: string;
  detail: string;
  queueDepth: number;
};

export type ThemeLabelMap = ReadonlyMap<string, string> | Record<string, string>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function cleanThemeLabel(value: string | null | undefined) {
  const label = value?.trim();
  if (!label || UUID_PATTERN.test(label)) return null;
  return label;
}

function themeLabelFromMap(themeLabelById: ThemeLabelMap | undefined, id: string) {
  if (!themeLabelById) return null;
  const maybeMap = themeLabelById as ReadonlyMap<string, string>;
  if (typeof maybeMap.get === "function") return maybeMap.get(id) ?? null;
  return (themeLabelById as Record<string, string | undefined>)[id] ?? null;
}

function uniqueLabels(labels: Array<string | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    if (!label || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  return result;
}

function resolveThemeLabels(
  company: ContractCompany,
  record: Record<string, unknown>,
  themeLabelById?: ThemeLabelMap,
) {
  const themeNames = uniqueLabels(stringArray(record.themes).map(cleanThemeLabel));
  if (themeNames.length > 0) return themeNames;

  const themeCodes = uniqueLabels(stringArray(record.themeCodes).map(cleanThemeLabel));
  if (themeCodes.length > 0) return themeCodes;

  return uniqueLabels(company.themeIds.map((id) => cleanThemeLabel(themeLabelFromMap(themeLabelById, id))));
}

export function toCompanyDetailView(
  company: ContractCompany,
  fallbackSymbol = "2330",
  themeLabelById?: ThemeLabelMap,
): CompanyDetailView {
  const record = company as unknown as Record<string, unknown>;
  const symbol = company.ticker || fallbackSymbol;

  return {
    id: company.id,
    symbol,
    ticker: company.ticker,
    name: company.name,
    nameEn: optionalString(record.nameEn),
    market: company.market,
    country: company.country,
    listing: optionalString(record.listing) ?? company.market,
    chainPosition: company.chainPosition,
    beneficiaryTier: company.beneficiaryTier,
    themes: resolveThemeLabels(company, record, themeLabelById),
    scorePct: null,
    momentum: "暫停",
    marketCapBn: null,
    intradayChgPct: null,
    fiiNetBn5d: null,
    notes: company.notes,
    exposure: company.exposure,
    validation: company.validation
  };
}

function sourceFromBar(source: string): CompanyDetailQuote["source"] {
  if (source === "kgi") return "kgi";
  if (source === "tej") return "finmind";
  return null;
}

export function quoteFromOhlcvBars<T extends { dt: string; open: number; close: number; volume: number; source: string }>(
  bars: T[] | null | undefined
): CompanyDetailQuote | null {
  if (!bars || bars.length === 0) return null;

  const last = bars[bars.length - 1];
  const source = sourceFromBar(last.source);
  if (!source) return null;

  const prev = bars.length >= 2 ? bars[bars.length - 2] : last;
  const change = Number((last.close - prev.close).toFixed(2));
  const changePercent = prev.close > 0 ? Number(((change / prev.close) * 100).toFixed(2)) : null;

  return {
    last: last.close,
    change,
    changePercent,
    volume: last.volume,
    asOf: new Date(`${last.dt}T13:30:00+08:00`).toISOString(),
    source
  };
}
