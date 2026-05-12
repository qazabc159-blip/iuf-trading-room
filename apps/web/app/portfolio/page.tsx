import {
  getCompanyByTicker,
  getCompanyOhlcv,
  getCompanyQuoteRealtime,
  getStrategyIdeas,
  type CompanyRealtimeQuote,
  type OhlcvBar,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import {
  getKgiPositions,
  getPaperHealth,
  getPaperPortfolio,
  listPaperFills,
  listPaperOrders,
  type KgiPositionsResponse,
  type PaperFillLedgerRow,
  type PaperHealthState,
  type PaperOrderState,
  type PaperPortfolioPosition,
} from "@/lib/paper-orders-api";

import { PaperRoomV03Client, type PaperCandidateV03 } from "./PaperRoomV03Client";

export const dynamic = "force-dynamic";

const DEFAULT_SYMBOL = "2330";

type PortfolioState =
  | { state: "LIVE"; positions: PaperPortfolioPosition[]; updatedAt: string }
  | { state: "EMPTY"; positions: PaperPortfolioPosition[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; positions: PaperPortfolioPosition[]; updatedAt: string; reason: string };

type FillsState =
  | { state: "LIVE"; fills: PaperFillLedgerRow[]; updatedAt: string }
  | { state: "EMPTY"; fills: PaperFillLedgerRow[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; fills: PaperFillLedgerRow[]; updatedAt: string; reason: string };

type OrdersState =
  | { state: "LIVE"; orders: PaperOrderState[]; updatedAt: string }
  | { state: "EMPTY"; orders: PaperOrderState[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; orders: PaperOrderState[]; updatedAt: string; reason: string };

type HealthState =
  | { state: "LIVE"; health: PaperHealthState; updatedAt: string }
  | { state: "BLOCKED"; health: null; updatedAt: string; reason: string };

type KgiState =
  | { state: "LIVE"; data: KgiPositionsResponse; updatedAt: string }
  | { state: "UNAVAILABLE"; data: KgiPositionsResponse; updatedAt: string; reason: string }
  | { state: "BLOCKED"; data: null; updatedAt: string; reason: string };

type MarketState =
  | {
      state: "LIVE";
      symbol: string;
      companyName: string;
      bars: OhlcvBar[];
      quote: CompanyRealtimeQuote | null;
      updatedAt: string;
      source: string;
    }
  | {
      state: "EMPTY" | "BLOCKED";
      symbol: string;
      companyName: string;
      bars: OhlcvBar[];
      quote: CompanyRealtimeQuote | null;
      updatedAt: string;
      source: string;
      reason: string;
    };

function nowIso() {
  return new Date().toISOString();
}

function userFacingReason(error: unknown, fallback: string) {
  return friendlyDataError(error, fallback)
    .replace(/token|secret|session|cookie|authorization|bearer|api[-_]?key|env|database|redis|root_cause/gi, "資料來源");
}

async function loadPaperPortfolio(): Promise<PortfolioState> {
  const updatedAt = nowIso();
  try {
    const positions = await getPaperPortfolio();
    if (positions.length === 0) {
      return { state: "EMPTY", positions, updatedAt, reason: "目前沒有模擬持倉。" };
    }
    return { state: "LIVE", positions, updatedAt };
  } catch (error) {
    return { state: "BLOCKED", positions: [], updatedAt, reason: userFacingReason(error, "模擬部位讀取失敗") };
  }
}

async function loadPaperFills(): Promise<FillsState> {
  const updatedAt = nowIso();
  try {
    const fills = await listPaperFills();
    if (fills.length === 0) {
      return { state: "EMPTY", fills, updatedAt, reason: "目前沒有模擬成交紀錄。" };
    }
    return { state: "LIVE", fills, updatedAt: fills.map((fill) => fill.fillTime).sort().at(-1) ?? updatedAt };
  } catch (error) {
    return { state: "BLOCKED", fills: [], updatedAt, reason: userFacingReason(error, "模擬成交讀取失敗") };
  }
}

async function loadPaperOrders(): Promise<OrdersState> {
  const updatedAt = nowIso();
  try {
    const orders = await listPaperOrders();
    if (orders.length === 0) {
      return { state: "EMPTY", orders, updatedAt, reason: "目前沒有模擬委託。" };
    }
    return { state: "LIVE", orders: orders.slice().reverse(), updatedAt };
  } catch (error) {
    return { state: "BLOCKED", orders: [], updatedAt, reason: userFacingReason(error, "模擬委託讀取失敗") };
  }
}

async function loadPaperHealth(): Promise<HealthState> {
  const updatedAt = nowIso();
  try {
    return { state: "LIVE", health: await getPaperHealth(), updatedAt };
  } catch (error) {
    return { state: "BLOCKED", health: null, updatedAt, reason: userFacingReason(error, "模擬交易狀態讀取失敗") };
  }
}

async function loadKgiPositions(): Promise<KgiState> {
  const updatedAt = nowIso();
  try {
    const data = await getKgiPositions();
    if (data.status === "ok" && data.positions.length > 0) {
      return { state: "LIVE", data, updatedAt };
    }
    const reasonMap: Record<string, string> = {
      gateway_unreachable: "凱基 gateway 目前無法連線。",
      gateway_not_authenticated: "凱基 gateway 尚未登入。",
      gateway_error: "凱基唯讀資料暫時無法取得。",
    };
    return {
      state: "UNAVAILABLE",
      data,
      updatedAt,
      reason: data.note ?? (data.status === "ok" ? "目前無真實持倉。" : reasonMap[data.status] ?? "凱基唯讀資料暫時無法取得。"),
    };
  } catch (error) {
    return { state: "BLOCKED", data: null, updatedAt, reason: userFacingReason(error, "凱基真實倉位讀取失敗") };
  }
}

async function loadCandidates(): Promise<PaperCandidateV03[]> {
  try {
    const data = (await getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 12, sort: "score" })).data;
    return data.items.map((item) => ({
      symbol: item.symbol,
      name: item.companyName,
      score: item.score,
      confidence: item.confidence,
      signalCount: item.signalCount,
      decision: item.marketData.decision,
      theme: item.topThemes[0]?.name ?? "策略候選",
    }));
  } catch {
    return [];
  }
}

async function loadMarketForSymbol(symbol: string): Promise<MarketState> {
  const updatedAt = nowIso();
  try {
    const company = await getCompanyByTicker(symbol);
    if (!company) {
      return {
        state: "EMPTY",
        symbol,
        companyName: symbol,
        bars: [],
        quote: null,
        updatedAt,
        source: "公司資料",
        reason: "尚未找到這檔股票的公司資料。",
      };
    }

    const [bars, quote] = await Promise.all([
      getCompanyOhlcv(company.id, { interval: "1d" }).catch(() => [] as OhlcvBar[]),
      getCompanyQuoteRealtime(company.id),
    ]);

    if (bars.length === 0 && !quote) {
      return {
        state: "EMPTY",
        symbol: company.ticker,
        companyName: company.name,
        bars,
        quote,
        updatedAt,
        source: "K 線 / 即時報價",
        reason: "目前沒有可用 K 線或唯讀報價。",
      };
    }

    return {
      state: "LIVE",
      symbol: company.ticker,
      companyName: company.name,
      bars,
      quote,
      updatedAt: quote?.updatedAt ?? bars.at(-1)?.dt ?? updatedAt,
      source: quote?.state === "LIVE" ? "凱基唯讀報價 + 日 K" : "日 K 資料",
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      symbol,
      companyName: symbol,
      bars: [],
      quote: null,
      updatedAt,
      source: "K 線 / 即時報價",
      reason: userFacingReason(error, "市場資料讀取失敗"),
    };
  }
}

function chooseSeedSymbol(
  querySymbol: string | undefined,
  portfolio: PortfolioState,
  candidates: PaperCandidateV03[],
) {
  const query = querySymbol?.trim().toUpperCase();
  if (query && /^[0-9A-Z]{2,10}$/.test(query)) return query;
  return portfolio.positions[0]?.symbol ?? candidates[0]?.symbol ?? DEFAULT_SYMBOL;
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<{ symbol?: string }>;
}) {
  const params = await searchParams;
  const [portfolio, fills, orders, health, kgi, candidates] = await Promise.all([
    loadPaperPortfolio(),
    loadPaperFills(),
    loadPaperOrders(),
    loadPaperHealth(),
    loadKgiPositions(),
    loadCandidates(),
  ]);
  const seedSymbol = chooseSeedSymbol(params?.symbol, portfolio, candidates);
  const market = await loadMarketForSymbol(seedSymbol);

  return (
    <PaperRoomV03Client
      candidates={candidates}
      fillsState={fills}
      healthState={health}
      kgiState={kgi}
      marketState={market}
      ordersState={orders}
      portfolioState={portfolio}
    />
  );
}
