import type { Company as ContractCompany } from "@iuf-trading-room/contracts";
import type { Company as RadarCompany, Quote as RadarQuote, Momentum } from "./radar-types";

export type SourceHealthState = "live" | "stale" | "error";
export type ValidationState = "positive" | "pending" | "negative";

export type CompanyDetailQuote = {
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  asOf: string | null;
  source: "kgi" | "finmind" | "mock" | null;
};

export type CompanyExposure = {
  volume: number;
  asp: number;
  margin: number;
  capacity: number;
  narrative: number;
};

export type CompanyValidation = {
  capitalFlow: ValidationState;
  consensus: ValidationState;
  relativeStrength: ValidationState;
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
  scorePct: number;
  momentum: Momentum | string;
  marketCapBn: number | null;
  intradayChgPct: number;
  fiiNetBn5d: number;
  notes: string;
  exposure: CompanyExposure;
  validation: CompanyValidation;
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

export type FinancialRow = {
  period: string;
  revenue: number;
  grossMargin: number;
  opMargin: number;
  eps: number;
  yoy: number;
};

export type RevenueRow = {
  month: string;
  revenue: number;
  yoy: number;
};

export type DividendRow = {
  year: string;
  cash: number;
  stock: number;
  yieldPct: number;
};

export type ChipsRow = {
  date: string;
  foreign: number;
  trust: number;
  dealer: number;
  marginBalance: number;
  shortBalance: number;
};

export type AnnouncementRow = {
  id: string;
  date: string;
  category: "重大訊息" | "法說" | "ESG" | "一般";
  title: string;
  body: string;
};

export type DerivativeRow = {
  label: string;
  value: string;
  state: ValidationState;
};

export type TickRow = {
  ts: string;
  price: number;
  qty: number;
  side: "B" | "S";
};

export type CompanyDetailMocks = {
  sources: SourceStatus[];
  financials: {
    quarterly: FinancialRow[];
    yearly: FinancialRow[];
    revenue: RevenueRow[];
    dividend: DividendRow[];
  };
  chips: ChipsRow[];
  announcements: AnnouncementRow[];
  derivatives: DerivativeRow[];
  ticks: TickRow[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : fallback;
}

function seedFromSymbol(symbol: string) {
  return symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function exposureFromSeed(seed: number): CompanyExposure {
  return {
    volume: 3 + (seed % 3),
    asp: 2 + ((seed + 1) % 4),
    margin: 2 + ((seed + 2) % 4),
    capacity: 3 + ((seed + 3) % 3),
    narrative: 2 + ((seed + 4) % 4),
  };
}

function validationFromCompany(fiiNetBn5d: number, intradayChgPct: number, scorePct: number): CompanyValidation {
  return {
    capitalFlow: fiiNetBn5d > 0.2 ? "positive" : fiiNetBn5d < -0.2 ? "negative" : "pending",
    consensus: scorePct >= 75 ? "positive" : scorePct < 55 ? "negative" : "pending",
    relativeStrength: intradayChgPct > 0.5 ? "positive" : intradayChgPct < -0.5 ? "negative" : "pending",
  };
}

export function toCompanyDetailView(company: RadarCompany | ContractCompany | unknown, fallbackSymbol = "2330"): CompanyDetailView {
  const record = asRecord(company);
  const symbol = stringValue(record.symbol, stringValue(record.ticker, fallbackSymbol));
  const ticker = stringValue(record.ticker, symbol);
  const seed = seedFromSymbol(symbol);
  const radarScore = numberValue(record.score, 0.68);
  const scorePct = radarScore <= 1 ? Math.round(radarScore * 100) : Math.round(radarScore);
  const intradayChgPct = numberValue(record.intradayChgPct, ((seed % 9) - 3) * 0.42);
  const fiiNetBn5d = numberValue(record.fiiNetBn5d, ((seed % 7) - 2) * 0.28);
  const marketCapBn = numberValue(record.marketCapBn, numberValue(record.marketCap, 100 + seed * 1.7));
  const name = stringValue(record.name, `公司 ${symbol}`);
  const market = stringValue(record.market, stringValue(record.listing, "TWSE"));
  const themes = stringArray(record.themes, stringArray(record.themeCodes, ["AI-PWR"]));

  return {
    id: stringValue(record.id, symbol),
    symbol,
    ticker,
    name,
    nameEn: stringValue(record.nameEn, "") || null,
    market,
    country: stringValue(record.country, "TW"),
    listing: stringValue(record.listing, market),
    chainPosition: stringValue(record.chainPosition, scorePct >= 80 ? "核心供應鏈" : "衛星供應鏈"),
    beneficiaryTier: stringValue(record.beneficiaryTier, scorePct >= 80 ? "Core" : scorePct >= 65 ? "Direct" : "Observation"),
    themes,
    scorePct: clamp(scorePct, 0, 100),
    momentum: stringValue(record.momentum, intradayChgPct > 0.5 ? "ACCEL" : intradayChgPct < -0.5 ? "DECEL" : "STEADY"),
    marketCapBn,
    intradayChgPct,
    fiiNetBn5d,
    notes: stringValue(
      record.notes,
      `${name} 目前放在 ${themes.join(" / ")} 觀察籃。此版為 RADAR 視覺骨架，財報、籌碼、公告、tick 均以 mock props 佔位，待 Jim lane 接回真實 endpoint。`,
    ),
    exposure: exposureFromSeed(seed),
    validation: validationFromCompany(fiiNetBn5d, intradayChgPct, clamp(scorePct, 0, 100)),
  };
}

export function toCompanyDetailQuote(quote: RadarQuote | null | undefined, company: CompanyDetailView): CompanyDetailQuote {
  if (quote) {
    return {
      last: quote.last,
      change: quote.change,
      changePercent: quote.changePct,
      volume: 1_200_000 + seedFromSymbol(company.symbol) * 1200,
      asOf: quote.asOf,
      source: quote.state === "LIVE" ? "kgi" : "mock",
    };
  }
  const base = Math.max(12, Math.round((company.marketCapBn ?? 100) / 15));
  const changePercent = company.intradayChgPct;
  const change = Number((base * changePercent / 100).toFixed(2));
  return {
    last: base,
    change,
    changePercent,
    volume: 800_000 + seedFromSymbol(company.symbol) * 900,
    asOf: new Date().toISOString(),
    source: "mock",
  };
}

export function buildCompanyDetailMocks(company: CompanyDetailView): CompanyDetailMocks {
  const seed = seedFromSymbol(company.symbol);
  const sourceTime = new Date(Date.now() - 18_000).toISOString();
  const olderTime = new Date(Date.now() - 98_000).toISOString();

  const quarterly = Array.from({ length: 8 }, (_, index) => {
    const q = 8 - index;
    const base = 42 + seed * 0.16 - index * 1.8;
    return {
      period: `202${q > 4 ? 5 : 4}Q${((q - 1) % 4) + 1}`,
      revenue: Math.round(base * 10) / 10,
      grossMargin: Math.round((44 + (seed % 9) - index * 0.7) * 10) / 10,
      opMargin: Math.round((24 + (seed % 6) - index * 0.5) * 10) / 10,
      eps: Math.round((3.2 + (seed % 8) * 0.2 - index * 0.08) * 100) / 100,
      yoy: Math.round((company.intradayChgPct * 2 + 12 - index * 1.7) * 10) / 10,
    };
  });
  const yearly = Array.from({ length: 5 }, (_, index) => ({
    period: `${2025 - index}`,
    revenue: Math.round((210 + seed * 0.75 - index * 18) * 10) / 10,
    grossMargin: Math.round((43 + (seed % 7) - index * 0.6) * 10) / 10,
    opMargin: Math.round((25 + (seed % 4) - index * 0.5) * 10) / 10,
    eps: Math.round((13.6 + (seed % 7) * 0.35 - index * 0.9) * 100) / 100,
    yoy: Math.round((18 - index * 4 + company.intradayChgPct) * 10) / 10,
  }));
  const revenue = Array.from({ length: 24 }, (_, index) => ({
    month: `202${index < 12 ? 5 : 4}-${String(12 - (index % 12)).padStart(2, "0")}`,
    revenue: Math.round((16 + seed * 0.04 + Math.sin(index / 2) * 3 + (24 - index) * 0.16) * 10) / 10,
    yoy: Math.round((8 + Math.cos(index / 3) * 7 - index * 0.2) * 10) / 10,
  }));
  const dividend = Array.from({ length: 5 }, (_, index) => ({
    year: `${2025 - index}`,
    cash: Math.round((2.4 + (seed % 6) * 0.35 - index * 0.08) * 100) / 100,
    stock: index % 3 === 0 ? 0.1 : 0,
    yieldPct: Math.round((2.1 + (seed % 4) * 0.25 - index * 0.06) * 100) / 100,
  }));
  const chips = Array.from({ length: 30 }, (_, index) => ({
    date: `D-${String(29 - index).padStart(2, "0")}`,
    foreign: Math.round((Math.sin(index / 3) * 1.9 + company.fiiNetBn5d / 2) * 100) / 100,
    trust: Math.round((Math.cos(index / 4) * 0.7 + 0.18) * 100) / 100,
    dealer: Math.round((Math.sin(index / 5) * 0.55 - 0.08) * 100) / 100,
    marginBalance: 1800 + seed * 3 + index * 9,
    shortBalance: 460 + seed + index * 3,
  }));
  const announcements: AnnouncementRow[] = [
    { id: "A1", date: "2026-04-30", category: "重大訊息", title: `${company.name} 董事會通過資本支出預算`, body: "此列為視覺 placeholder，後續接公開資訊觀測站公告摘要與原文連結。" },
    { id: "A2", date: "2026-04-28", category: "法說", title: `${company.name} 法說重點：產能與毛利率展望`, body: "重點放在產能利用率、ASP、庫存水位與主要客戶拉貨節奏。" },
    { id: "A3", date: "2026-04-21", category: "ESG", title: "永續報告書更新", body: "ESG 資料仍由 OpenAlice 後續抽取，目前不作交易判斷。" },
    { id: "A4", date: "2026-04-12", category: "一般", title: "月營收發布提醒", body: "待 revenue endpoint 接上後，此處顯示最近 24 個月營收趨勢摘要。" },
  ];

  return {
    sources: [
      { id: "finmind", label: "FinMind OHLCV", state: "live", summary: "daily bars mock-ready", lastSeen: sourceTime, detail: "W7 H1 endpoint draft; Codex lane only consumes props.", queueDepth: 0 },
      { id: "kgi", label: "KGI quote", state: "live", summary: "quote / bidask live", lastSeen: sourceTime, detail: "order routing remains blocked; UI is read-only.", queueDepth: 1 },
      { id: "twse", label: "TWSE OpenAPI", state: "stale", summary: "announcement cache", lastSeen: olderTime, detail: "public filing sync pending Jim/Jason binding.", queueDepth: 4 },
      { id: "redis", label: "Redis cache", state: "live", summary: "hit 87%", lastSeen: sourceTime, detail: "cache badge is mock until source/status endpoint lands.", queueDepth: 0 },
    ],
    financials: { quarterly, yearly, revenue, dividend },
    chips,
    announcements,
    derivatives: [
      { label: "台指期相關度", value: "W7 D7 待接", state: "pending" },
      { label: "選擇權未平倉", value: "暫無資料", state: "pending" },
      { label: "借券賣出", value: "placeholder", state: "pending" },
    ],
    ticks: Array.from({ length: 12 }, (_, index) => ({
      ts: new Date(Date.now() - index * 9000).toLocaleTimeString("zh-TW", { hour12: false }),
      price: Math.round(((company.marketCapBn ?? 120) / 15 + Math.sin(index) * 1.2) * 100) / 100,
      qty: 1 + ((seed + index) % 18),
      side: index % 3 === 0 ? "S" : "B",
    })),
  };
}

