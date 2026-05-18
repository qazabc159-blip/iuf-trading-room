/**
 * market-data-tools.ts — Read-only market data tools for Brain ReAct AI Recommendation v2.
 *
 * These 5 tools wrap existing market-data surfaces (no new upstream calls, no KGI dependency).
 * All are registered in ToolCenter (tools table, migration 0041) and called via callTool().
 *
 * Tool keys:
 *   get_market_overview    — TWSE TAIEX overview (index + change + volume)
 *   get_sector_rotation    — sector relative strength from OHLCV + institutional flow
 *   get_company_technical  — K-line, RSI, MA20/60/200, volume for a ticker
 *   get_institutional_flow — 3-party institutional net buy/sell for a ticker
 *   get_news_top10         — AI-curated top-10 news from news-ai-selector
 *
 * Hard rules:
 *   - No write-ops, no broker calls, no order submission.
 *   - No import from risk-engine, broker/*, market-data.ts (market-data surface only).
 *   - All functions are fail-open (return partial data on upstream error).
 *   - All are wrapped by callTool() in the orchestrator (ToolCenter audit).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarketOverviewResult {
  taiex: {
    index: number | null;
    change: number | null;
    changePct: number | null;
    volume: number | null;
  } | null;
  otc: {
    index: number | null;
    change: number | null;
    changePct: number | null;
  } | null;
  source: string;
  asOf: string | null;
  sourceState: "live" | "lkg" | "unavailable";
}

export interface SectorStrengthRow {
  sector: string;
  avgChangePct: number;
  gainerCount: number;
  loserCount: number;
  stockCount: number;
  institutionalNetBuy?: number | null;
}

export interface SectorRotationResult {
  sectors: SectorStrengthRow[];
  asOf: string;
  source: string;
}

export interface CompanyTechnicalResult {
  ticker: string;
  lastPrice: number | null;
  changePct: number | null;
  volume: number | null;
  rsi14: number | null;
  ma20: number | null;
  ma60: number | null;
  ma200: number | null;
  /** true if price > MA20 */
  aboveMa20: boolean | null;
  /** true if price > MA60 */
  aboveMa60: boolean | null;
  /** true if price > MA200 */
  aboveMa200: boolean | null;
  /** Volume vs 20-day avg volume ratio */
  volumeRatio20d: number | null;
  source: string;
  asOf: string | null;
}

export interface InstitutionalFlowResult {
  ticker: string;
  /** Net buy (positive) or sell (negative) last 30 days, in shares */
  foreign30dNetShares: number | null;
  investmentTrust30dNetShares: number | null;
  dealer30dNetShares: number | null;
  total30dNetShares: number | null;
  /** Most recent date in the data */
  latestDate: string | null;
  rowCount: number;
  source: string;
}

export interface NewsTop10Result {
  items: Array<{
    id: string;
    title: string;
    ticker?: string | null;
    companyName?: string | null;
    sentiment?: string | null;
    source?: string | null;
    publishedAt?: string | null;
  }>;
  asOf: string | null;
  runId: string | null;
  itemCount: number;
}

// ── get_market_overview ───────────────────────────────────────────────────────

/**
 * Fetches TWSE market overview: TAIEX index + OTC index + volumes.
 * Wraps the twse-openapi-client — same data as /api/v1/market/overview/twse.
 * Fail-open: returns {taiex:null, otc:null, sourceState:"unavailable"} on error.
 */
export async function getMarketOverview(): Promise<MarketOverviewResult> {
  try {
    const { getTwseMarketOverview } = await import("../data-sources/twse-openapi-client.js");
    const result = await getTwseMarketOverview();
    if (!result) {
      return { taiex: null, otc: null, source: "twse_openapi", asOf: null, sourceState: "unavailable" };
    }
    const { _isLkg, taiex, otc, asOf } = result as {
      _isLkg?: boolean;
      taiex?: { index?: number; change?: number; changePct?: number; volume?: number } | null;
      otc?: { index?: number; change?: number; changePct?: number } | null;
      asOf?: string | null;
    };
    return {
      taiex: taiex ? {
        index: taiex.index ?? null,
        change: taiex.change ?? null,
        changePct: taiex.changePct ?? null,
        volume: taiex.volume ?? null,
      } : null,
      otc: otc ? {
        index: otc.index ?? null,
        change: otc.change ?? null,
        changePct: otc.changePct ?? null,
      } : null,
      source: "twse_openapi",
      asOf: (asOf as string | null | undefined) ?? null,
      sourceState: _isLkg ? "lkg" : "live",
    };
  } catch (err) {
    console.warn("[get_market_overview] error:", err instanceof Error ? err.message : err);
    return { taiex: null, otc: null, source: "twse_openapi", asOf: null, sourceState: "unavailable" };
  }
}

// ── get_sector_rotation ───────────────────────────────────────────────────────

/**
 * Returns sector relative strength from TWSE OHLCV heatmap data.
 * Wraps getStockDayAllRows() — same source as /api/v1/market/heatmap/twse.
 * Groups by industry from TWSE response, computes avg changePct + gainer/loser counts.
 * Fail-open: returns empty sectors array on error.
 */
export async function getSectorRotation(limit = 20): Promise<SectorRotationResult> {
  const asOf = new Date().toISOString();
  try {
    const { getStockDayAllRows } = await import("../data-sources/twse-openapi-client.js");
    const rows = await getStockDayAllRows().catch(() => []);
    if (rows.length === 0) {
      return { sectors: [], asOf, source: "twse_stock_day_all" };
    }

    // Group by industry
    const sectorMap = new Map<string, { changePcts: number[]; gainers: number; losers: number }>();
    for (const row of rows as Array<{ industry?: string | null; changePct?: number | null }>) {
      const sector = row.industry ?? "其他";
      const cp = row.changePct ?? 0;
      const entry = sectorMap.get(sector) ?? { changePcts: [], gainers: 0, losers: 0 };
      entry.changePcts.push(cp);
      if (cp > 0) entry.gainers++;
      else if (cp < 0) entry.losers++;
      sectorMap.set(sector, entry);
    }

    const sectors: SectorStrengthRow[] = [];
    for (const [sector, data] of sectorMap.entries()) {
      const avg = data.changePcts.reduce((a, b) => a + b, 0) / data.changePcts.length;
      sectors.push({
        sector,
        avgChangePct: Math.round(avg * 100) / 100,
        gainerCount: data.gainers,
        loserCount: data.losers,
        stockCount: data.changePcts.length,
      });
    }

    // Sort by avgChangePct desc, limit
    sectors.sort((a, b) => b.avgChangePct - a.avgChangePct);
    return { sectors: sectors.slice(0, limit), asOf, source: "twse_stock_day_all" };
  } catch (err) {
    console.warn("[get_sector_rotation] error:", err instanceof Error ? err.message : err);
    return { sectors: [], asOf, source: "twse_stock_day_all" };
  }
}

// ── get_company_technical ─────────────────────────────────────────────────────

/**
 * Returns technical data for a specific ticker: OHLCV, RSI14, MA20/60/200.
 * Pulls from companies_ohlcv DB table (FinMind-sourced historical prices).
 * Fail-open: returns nulls on missing data — LLM sees "data unavailable" gracefully.
 */
export async function getCompanyTechnical(ticker: string): Promise<CompanyTechnicalResult> {
  const base: CompanyTechnicalResult = {
    ticker,
    lastPrice: null,
    changePct: null,
    volume: null,
    rsi14: null,
    ma20: null,
    ma60: null,
    ma200: null,
    aboveMa20: null,
    aboveMa60: null,
    aboveMa200: null,
    volumeRatio20d: null,
    source: "companies_ohlcv",
    asOf: null,
  };
  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return base;
    const db = getDb();
    if (!db) return base;

    // Fetch last 200 OHLCV rows for this ticker (enough for MA200)
    // companies_ohlcv columns: company_id (uuid) + dt (date) — lookup via companies.ticker first
    const { sql } = await import("drizzle-orm");
    const rows = (await db.execute(sql`
      SELECT o.dt AS date, o.close AS close, o.volume AS volume
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
      ORDER BY o.dt DESC
      LIMIT 200
    `)) as unknown as { rows: Array<{ date: string; close: string; volume: string }> };

    let data = (rows.rows ?? []) as Array<{ date: string; close: string; volume: string }>;
    let source = "companies_ohlcv";
    if (data.length === 0 && /^\d{4}[A-Z]?$/.test(ticker) && process.env["FINMIND_API_TOKEN"]) {
      const { getFinMindClient } = await import("../data-sources/finmind-client.js");
      const startDate = new Date(Date.now() - 280 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const bars = await getFinMindClient().getStockPriceAdj(ticker, startDate, null);
      data = bars
        .slice(-200)
        .reverse()
        .map((bar) => ({
          date: bar.dt,
          close: String(bar.close),
          volume: String(bar.volume),
        }));
      source = "finmind_ohlcv";
    }
    if (data.length === 0) return base;

    const closes = data.map(r => parseFloat(r.close)).filter(v => !isNaN(v));
    const volumes = data.map(r => parseFloat(r.volume)).filter(v => !isNaN(v));

    if (closes.length === 0) return base;

    const last = closes[0]!;
    const prev = closes[1] ?? last;
    const changePct = prev !== 0 ? Math.round(((last - prev) / prev) * 10000) / 100 : 0;

    // Moving averages (data is desc, so closes[0]=latest)
    const ma = (n: number): number | null => {
      if (closes.length < n) return null;
      const slice = closes.slice(0, n);
      return Math.round((slice.reduce((a, b) => a + b, 0) / n) * 100) / 100;
    };

    // RSI14
    let rsi14: number | null = null;
    if (closes.length >= 15) {
      const prices = closes.slice(0, 15).reverse(); // ascending order
      let gains = 0, losses = 0;
      for (let i = 1; i < prices.length; i++) {
        const diff = (prices[i] ?? 0) - (prices[i - 1] ?? 0);
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
      }
      const avgGain = gains / 14;
      const avgLoss = losses / 14;
      if (avgLoss === 0) rsi14 = 100;
      else rsi14 = Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
    }

    // Volume ratio vs 20d avg
    let volumeRatio20d: number | null = null;
    const latestVol = volumes[0] ?? null;
    if (latestVol !== null && volumes.length >= 20) {
      const avg20 = volumes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
      volumeRatio20d = avg20 > 0 ? Math.round((latestVol / avg20) * 100) / 100 : null;
    }

    const ma20v = ma(20);
    const ma60v = ma(60);
    const ma200v = ma(200);

    return {
      ticker,
      lastPrice: last,
      changePct,
      volume: volumes[0] ?? null,
      rsi14,
      ma20: ma20v,
      ma60: ma60v,
      ma200: ma200v,
      aboveMa20: ma20v !== null ? last > ma20v : null,
      aboveMa60: ma60v !== null ? last > ma60v : null,
      aboveMa200: ma200v !== null ? last > ma200v : null,
      volumeRatio20d,
      source,
      asOf: data[0]?.date ?? null,
    };
  } catch (err) {
    console.warn("[get_company_technical] error for", ticker, ":", err instanceof Error ? err.message : err);
    return base;
  }
}

// ── get_institutional_flow ────────────────────────────────────────────────────

/**
 * Returns institutional buy/sell net flow for a ticker (last 30 days).
 * Source: tw_institutional_buysell DB table (FinMind-sourced).
 * Fail-open: returns nulls when no data.
 */
export async function getInstitutionalFlow(ticker: string): Promise<InstitutionalFlowResult> {
  const base: InstitutionalFlowResult = {
    ticker,
    foreign30dNetShares: null,
    investmentTrust30dNetShares: null,
    dealer30dNetShares: null,
    total30dNetShares: null,
    latestDate: null,
    rowCount: 0,
    source: "tw_institutional_buysell",
  };
  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return base;
    const db = getDb();
    if (!db) return base;

    const { sql } = await import("drizzle-orm");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rows = (await db.execute(sql`
      SELECT date, name, buy, sell
      FROM tw_institutional_buysell
      WHERE stock_id = ${ticker}
        AND date >= ${cutoffStr}
      ORDER BY date DESC
    `)) as unknown as { rows: Array<{ date: string; name: string; buy: string; sell: string }> };

    const data = (rows.rows ?? []) as Array<{ date: string; name: string; buy: string; sell: string }>;
    if (data.length === 0) return base;

    let foreign = 0, trust = 0, dealer = 0;
    for (const row of data) {
      const net = (parseFloat(row.buy) || 0) - (parseFloat(row.sell) || 0);
      const name = (row.name ?? "").toLowerCase();
      if (name.includes("foreign") || name.includes("外資")) foreign += net;
      else if (name.includes("trust") || name.includes("投信")) trust += net;
      else if (name.includes("dealer") || name.includes("自營")) dealer += net;
    }

    return {
      ticker,
      foreign30dNetShares: Math.round(foreign),
      investmentTrust30dNetShares: Math.round(trust),
      dealer30dNetShares: Math.round(dealer),
      total30dNetShares: Math.round(foreign + trust + dealer),
      latestDate: data[0]?.date ?? null,
      rowCount: data.length,
      source: "tw_institutional_buysell",
    };
  } catch (err) {
    console.warn("[get_institutional_flow] error for", ticker, ":", err instanceof Error ? err.message : err);
    return base;
  }
}

// ── get_news_top10 ────────────────────────────────────────────────────────────

/**
 * Returns today's AI-curated top-10 news from news-ai-selector in-process state.
 * Same data as /api/v1/market-intel/news-top10 — uses getNewsTop10WithStaleness().
 * Fail-open: returns empty items when no data available.
 */
export async function getNewsTop10(): Promise<NewsTop10Result> {
  try {
    const { getNewsTop10ForRead } = await import("../news-ai-selector.js");
    const cached = await getNewsTop10ForRead();
    if (!cached) {
      return { items: [], asOf: null, runId: null, itemCount: 0 };
    }
    const items = (cached.items ?? []) as Array<{
      id?: string;
      title?: string;
      headline?: string;
      ticker?: string | null;
      companyName?: string | null;
      sentiment?: string | null;
      source?: string | null;
      publishedAt?: string | null;
    }>;
    return {
      items: items.map(item => ({
        id: item.id ?? "",
        title: item.title ?? item.headline ?? "",
        ticker: item.ticker ?? null,
        companyName: item.companyName ?? null,
        sentiment: item.sentiment ?? null,
        source: item.source ?? null,
        publishedAt: item.publishedAt ?? null,
      })),
      asOf: (cached as { as_of?: string | null }).as_of ?? null,
      runId: (cached as { run_id?: string | null }).run_id ?? null,
      itemCount: items.length,
    };
  } catch (err) {
    console.warn("[get_news_top10] error:", err instanceof Error ? err.message : err);
    return { items: [], asOf: null, runId: null, itemCount: 0 };
  }
}
