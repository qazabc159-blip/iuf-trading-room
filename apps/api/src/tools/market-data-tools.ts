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
  companyName: string | null;
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
 * Primary: getStockDayAllRows() (real-time TWSE, available during trading hours).
 * Fallback: companies_ohlcv + companies.chain_position from DB (post-market / off-hours).
 *
 * When StockDayAll returns empty (after close or weekend), the fallback computes
 * the most-recent trading day's per-sector avg changePct from the DB so the LLM
 * always gets meaningful sector rotation context instead of a single "其他" bucket.
 *
 * Fail-open: returns empty sectors array only when both sources fail.
 */
export async function getSectorRotation(limit = 20): Promise<SectorRotationResult> {
  const asOf = new Date().toISOString();
  try {
    const { getStockDayAllRows } = await import("../data-sources/twse-openapi-client.js");
    const rows = await getStockDayAllRows().catch((err) => {
      console.warn("[get_sector_rotation] getStockDayAllRows failed, treating as empty:", err instanceof Error ? err.message : err);
      return [];
    });

    if (rows.length > 0) {
      // ── Primary path: live TWSE StockDayAll ──────────────────────────────────
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
      sectors.sort((a, b) => b.avgChangePct - a.avgChangePct);
      return { sectors: sectors.slice(0, limit), asOf, source: "twse_stock_day_all" };
    }

    // ── Fallback path: DB companies_ohlcv + companies.chain_position ────────────
    // Fires post-market / weekends when StockDayAll returns no rows.
    console.info("[get_sector_rotation] StockDayAll empty — falling back to DB OHLCV sector aggregation");
    return await getSectorRotationFromDb(limit, asOf);
  } catch (err) {
    console.warn("[get_sector_rotation] error:", err instanceof Error ? err.message : err);
    return { sectors: [], asOf, source: "twse_stock_day_all" };
  }
}

/**
 * DB fallback for getSectorRotation() — computes per-sector avg changePct from
 * the most-recent trading day in companies_ohlcv, grouped by companies.chain_position
 * (the same ticker->industry/sector proxy already used by the KGI-core heatmap
 * route and the FinMind industry heatmap route — see server.ts "sector lookup").
 *
 * 2026-07-24 fix: this previously queried the non-existent companies.industry
 * column (companies never had that column — only chain_position; see schema.ts
 * and information_schema on prod). Postgres threw "column c.industry does not
 * exist" on every call, the error was swallowed by the catch below, and this
 * branch always returned an empty sectors array. Exported separately so it can
 * be exercised directly in a DB-mode test without depending on a live TWSE
 * StockDayAll call.
 */
export async function getSectorRotationFromDb(limit: number, asOf: string): Promise<SectorRotationResult> {
  try {
    const { getDb, isDatabaseMode, execRows } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return { sectors: [], asOf, source: "twse_stock_day_all" };
    const db = getDb();
    if (!db) return { sectors: [], asOf, source: "twse_stock_day_all" };

    const { sql } = await import("drizzle-orm");
    // Find the most recent date in OHLCV
    const latestDateRows = await db.execute(sql`
      SELECT MAX(dt) AS max_dt FROM companies_ohlcv WHERE interval IN ('1d', 'day')
    `);
    const latestDate = execRows<{ max_dt: string | null }>(latestDateRows)[0]?.max_dt;
    if (!latestDate) return { sectors: [], asOf, source: "db_ohlcv_fallback" };

    // Fetch all stocks for that date with their previous-day close for changePct
    const sectorRows = await db.execute(sql`
      SELECT
        c.chain_position AS industry,
        o.close AS close,
        o_prev.close AS prev_close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      LEFT JOIN companies_ohlcv o_prev
        ON o_prev.company_id = o.company_id
        AND o_prev.interval IN ('1d', 'day')
        AND o_prev.dt = (
          SELECT MAX(dt2.dt) FROM companies_ohlcv dt2
          WHERE dt2.company_id = o.company_id
            AND dt2.interval IN ('1d', 'day')
            AND dt2.dt < ${latestDate}
        )
      WHERE o.dt = ${latestDate}
        AND o.interval IN ('1d', 'day')
        AND c.chain_position IS NOT NULL
        AND c.chain_position <> ''
      LIMIT 2000
    `);

    const dbRows = execRows<{ industry: string; close: string; prev_close: string | null }>(sectorRows);
    if (dbRows.length === 0) return { sectors: [], asOf, source: "db_ohlcv_fallback" };

    const sectorMap = new Map<string, { changePcts: number[]; gainers: number; losers: number }>();
    for (const row of dbRows) {
      const sector = row.industry ?? "其他";
      const close = parseFloat(row.close);
      const prevClose = row.prev_close ? parseFloat(row.prev_close) : null;
      const cp = (prevClose && prevClose > 0) ? Math.round(((close - prevClose) / prevClose) * 10000) / 100 : 0;
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
    sectors.sort((a, b) => b.avgChangePct - a.avgChangePct);
    return { sectors: sectors.slice(0, limit), asOf: latestDate, source: "db_ohlcv_fallback" };
  } catch (dbErr) {
    console.warn("[get_sector_rotation] DB fallback error:", dbErr instanceof Error ? dbErr.message : dbErr);
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
    companyName: null,
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
    const { getDb, isDatabaseMode, execRows } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return base;
    const db = getDb();
    if (!db) return base;

    // Fetch last 200 OHLCV rows for this ticker (enough for MA200)
    // companies_ohlcv columns: company_id (uuid) + dt (date) — lookup via companies.ticker first
    const { sql } = await import("drizzle-orm");
    const companyRows = await db.execute(sql`
      SELECT name
      FROM companies
      WHERE ticker = ${ticker}
      LIMIT 1
    `);
    const companyName = execRows<{ name: string | null }>(companyRows)[0]?.name ?? null;

    const rows = await db.execute(sql`
      SELECT o.dt AS date, o.close AS close, o.volume AS volume
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
      ORDER BY o.dt DESC
      LIMIT 200
    `);

    let data = execRows<{ date: string; close: string; volume: string }>(rows);
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
    if (data.length === 0) return { ...base, companyName };

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
      companyName,
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
    const { getDb, isDatabaseMode, execRows } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return base;
    const db = getDb();
    if (!db) return base;

    const { sql } = await import("drizzle-orm");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rows = await db.execute(sql`
      SELECT date, name, buy, sell
      FROM tw_institutional_buysell
      WHERE stock_id = ${ticker}
        AND date >= ${cutoffStr}
      ORDER BY date DESC
    `);

    const data = execRows<{ date: string; name: string; buy: string; sell: string }>(rows);
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

// ── get_company_fundamentals ─────────────────────────────────────────────────

export interface CompanyRevenueMonth {
  month: string;           // 'YYYY-MM'
  revenue: number;
  yoy: number | null;      // % YoY vs same month last year
  mom: number | null;      // % MoM vs prior month
}

export interface CompanyFundamentalsResult {
  ticker: string;
  /** Monthly revenue: up to 6 months, newest first */
  monthlyRevenue: CompanyRevenueMonth[];
  revenueYoyTrend: "accelerating" | "decelerating" | "positive" | "negative" | "unavailable";
  /** Latest quarterly financials */
  latestQuarterDate: string | null;
  epsLatestQuarter: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  /** Valuation */
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  dataAvailable: boolean;
  reason: string;
  source: string;
}

export function revenuePeriodKey(row: { date: string; revenue_year?: number; revenue_month?: number }): string {
  const year = Number(row.revenue_year);
  const month = Number(row.revenue_month);
  if (Number.isInteger(year) && year >= 1900 && Number.isInteger(month) && month >= 1 && month <= 12) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return row.date.slice(0, 7);
}

/**
 * Fetches fundamental data for a specific ticker from FinMind:
 *   - Monthly revenue (last 6 months, YoY / MoM computed)
 *   - Quarterly financial statements (EPS, gross margin, operating margin)
 *   - PER / PBR / dividend yield
 *
 * Fail-open: returns dataAvailable=false when token missing, circuit open, or all upstream empty.
 * No DB table for fundamentals — hits FinMind API directly (cached via Redis).
 */
export async function getCompanyFundamentals(ticker: string): Promise<CompanyFundamentalsResult> {
  const base: CompanyFundamentalsResult = {
    ticker,
    monthlyRevenue: [],
    revenueYoyTrend: "unavailable",
    latestQuarterDate: null,
    epsLatestQuarter: null,
    grossMarginPct: null,
    operatingMarginPct: null,
    per: null,
    pbr: null,
    dividendYield: null,
    dataAvailable: false,
    reason: "not_attempted",
    source: "finmind",
  };

  try {
    const { getFinMindClient } = await import("../data-sources/finmind-client.js");
    const client = getFinMindClient();

    if (!client.hasToken()) {
      return { ...base, reason: "finmind_token_missing" };
    }

    // ── Monthly revenue: last ~18 months so we can compute 6 months of YoY ──
    const revenueStartDate = new Date(Date.now() - 18 * 31 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const revenueEndDate = new Date().toISOString().slice(0, 10);

    const revenueRows = await client.getMonthRevenue(ticker, revenueStartDate, revenueEndDate)
      .catch(() => []);

    // Sort descending
    const sortedRevenue = [...revenueRows].sort((a, b) => b.date.localeCompare(a.date));

    // FinMind row.date is the publication date. revenue_year/revenue_month is
    // the actual accounting period and must drive user-facing month labels.
    const revenueByMonth = new Map<string, number>();
    for (const row of sortedRevenue) {
      const monthKey = revenuePeriodKey(row);
      if (!revenueByMonth.has(monthKey)) {
        revenueByMonth.set(monthKey, row.revenue);
      }
    }

    const monthlyRevenue: CompanyRevenueMonth[] = [];
    const recentMonths = Array.from(revenueByMonth.keys()).slice(0, 8);
    for (let i = 0; i < Math.min(6, recentMonths.length); i++) {
      const monthKey = recentMonths[i]!;
      const revenue = revenueByMonth.get(monthKey)!;
      const [yr, mo] = monthKey.split("-");
      const lastYearKey = `${parseInt(yr!) - 1}-${mo}`;
      const lastYearRevenue = revenueByMonth.get(lastYearKey) ?? null;
      const yoy = lastYearRevenue !== null && lastYearRevenue > 0
        ? Math.round(((revenue - lastYearRevenue) / lastYearRevenue) * 10000) / 100
        : null;
      const priorMonth = recentMonths[i + 1] ?? null;
      const priorRevenue = priorMonth ? (revenueByMonth.get(priorMonth) ?? null) : null;
      const mom = priorRevenue !== null && priorRevenue > 0
        ? Math.round(((revenue - priorRevenue) / priorRevenue) * 10000) / 100
        : null;
      monthlyRevenue.push({ month: monthKey, revenue, yoy, mom });
    }

    const yoyValues = monthlyRevenue.map(m => m.yoy).filter((v): v is number => v !== null);
    let revenueYoyTrend: CompanyFundamentalsResult["revenueYoyTrend"] = "unavailable";
    if (yoyValues.length >= 2) {
      const allPositive = yoyValues.every(v => v > 0);
      const allNegative = yoyValues.every(v => v < 0);
      const accelerating = yoyValues[0]! > yoyValues[1]!;
      if (allPositive && accelerating) revenueYoyTrend = "accelerating";
      else if (allPositive) revenueYoyTrend = "positive";
      else if (allNegative) revenueYoyTrend = "negative";
      else revenueYoyTrend = "decelerating";
    } else if (yoyValues.length === 1) {
      revenueYoyTrend = yoyValues[0]! > 0 ? "positive" : "negative";
    }

    // ── Financial statements: last ~5 quarters ────────────────────────────────
    const finStartDate = new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const finRows = await client.getFinancialStatements(ticker, finStartDate, revenueEndDate)
      .catch(() => []);

    let latestQuarterDate: string | null = null;
    let epsLatestQuarter: number | null = null;
    let grossMarginPct: number | null = null;
    let operatingMarginPct: number | null = null;

    if (finRows.length > 0) {
      const sortedFin = [...finRows].sort((a, b) => b.date.localeCompare(a.date));
      latestQuarterDate = sortedFin[0]?.date ?? null;
      const latestDate = latestQuarterDate;
      const latestRows = sortedFin.filter(r => r.date === latestDate);
      const byType = new Map<string, number>();
      for (const row of latestRows) {
        if (row.type) byType.set(row.type.toLowerCase(), row.value);
      }
      const eps = byType.get("eps") ?? byType.get("basiceps") ?? byType.get("basic_eps") ?? null;
      epsLatestQuarter = eps !== null ? Math.round(eps * 100) / 100 : null;
      const grossProfit = byType.get("grossprofit") ?? byType.get("gross_profit") ?? null;
      const revenue = byType.get("revenue") ?? byType.get("total_revenue") ?? null;
      if (grossProfit !== null && revenue !== null && revenue > 0) {
        grossMarginPct = Math.round((grossProfit / revenue) * 10000) / 100;
      }
      const opIncome = byType.get("operatingincome") ?? byType.get("operating_income") ?? null;
      if (opIncome !== null && revenue !== null && revenue > 0) {
        operatingMarginPct = Math.round((opIncome / revenue) * 10000) / 100;
      }
    }

    // ── PER / PBR / dividend yield ────────────────────────────────────────────
    const perStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const perRows = await client.getPER(ticker, perStartDate, revenueEndDate).catch(() => []);

    let per: number | null = null;
    let pbr: number | null = null;
    let dividendYield: number | null = null;

    if (perRows.length > 0) {
      const latestPer = [...perRows].sort((a, b) => b.date.localeCompare(a.date))[0];
      if (latestPer) {
        per = latestPer.PER > 0 ? Math.round(latestPer.PER * 100) / 100 : null;
        pbr = latestPer.PBR > 0 ? Math.round(latestPer.PBR * 100) / 100 : null;
        dividendYield = latestPer.dividend_yield >= 0
          ? Math.round(latestPer.dividend_yield * 100) / 100
          : null;
      }
    }

    const dataAvailable = monthlyRevenue.length > 0 || epsLatestQuarter !== null || per !== null;

    return {
      ticker,
      monthlyRevenue,
      revenueYoyTrend,
      latestQuarterDate,
      epsLatestQuarter,
      grossMarginPct,
      operatingMarginPct,
      per,
      pbr,
      dividendYield,
      dataAvailable,
      reason: dataAvailable ? "ok" : "finmind_data_empty",
      source: "finmind",
    };
  } catch (err) {
    console.warn("[get_company_fundamentals] error for", ticker, ":", err instanceof Error ? err.message : err);
    return { ...base, reason: "error" };
  }
}

// ── get_supply_chain ──────────────────────────────────────────────────────────

export interface SupplyChainResult {
  ticker: string;
  /** e.g. "CoAP_Chip", "EMS", "Material" — from companies.chain_position */
  chainPosition: string | null;
  /** "Core" | "Direct" | "Indirect" | "Observation" */
  beneficiaryTier: string | null;
  themes: Array<{ name: string; lifecycle: string }>;
  suppliers: Array<{ ticker: string | null; label: string; confidence: number }>;
  customers: Array<{ ticker: string | null; label: string; confidence: number }>;
  peers: Array<{ ticker: string | null; label: string; confidence: number }>;
  dataAvailable: boolean;
  source: string;
}

/**
 * Returns supply chain positioning for a ticker from the companies DB:
 *   - chainPosition + beneficiaryTier (楊董 4-tier framework)
 *   - Associated investment themes (name + lifecycle)
 *   - Relations: suppliers, customers, technology peers (confidence >= 0.3)
 *
 * Fail-open: returns dataAvailable=false when DB unavailable or company not found.
 * Pure DB query — no external API.
 */
export async function getSupplyChain(ticker: string): Promise<SupplyChainResult> {
  const base: SupplyChainResult = {
    ticker,
    chainPosition: null,
    beneficiaryTier: null,
    themes: [],
    suppliers: [],
    customers: [],
    peers: [],
    dataAvailable: false,
    source: "company_graph_db",
  };

  try {
    const { getDb, isDatabaseMode, execRows } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return base;
    const db = getDb();
    if (!db) return base;

    const { sql } = await import("drizzle-orm");

    // Company lookup
    const companyRows = await db.execute(sql`
      SELECT id, chain_position, beneficiary_tier
      FROM companies
      WHERE ticker = ${ticker}
      LIMIT 1
    `);

    const company = execRows<{ id: string; chain_position: string | null; beneficiary_tier: string | null }>(companyRows)[0];
    if (!company) return base;
    const companyId = company.id;

    // Themes via company_theme_links
    const themeRows = await db.execute(sql`
      SELECT t.name, t.lifecycle
      FROM company_theme_links ctl
      INNER JOIN themes t ON t.id = ctl.theme_id
      WHERE ctl.company_id = ${companyId}
      LIMIT 10
    `);

    // Relations (outbound, confidence >= 0.3)
    const relRows = await db.execute(sql`
      SELECT
        cr.relation_type,
        cr.target_company_id,
        cr.target_label,
        cr.confidence,
        tc.ticker AS target_ticker
      FROM company_relations cr
      LEFT JOIN companies tc ON tc.id = cr.target_company_id
      WHERE cr.company_id = ${companyId}
        AND cr.confidence >= 0.3
      ORDER BY cr.confidence DESC
      LIMIT 30
    `);

    const suppliers: SupplyChainResult["suppliers"] = [];
    const customers: SupplyChainResult["customers"] = [];
    const peers: SupplyChainResult["peers"] = [];

    for (const rel of execRows<{
      relation_type: string;
      target_company_id: string | null;
      target_label: string;
      confidence: number;
      target_ticker: string | null;
    }>(relRows)) {
      const entry = {
        ticker: rel.target_ticker ?? null,
        label: rel.target_label,
        confidence: Math.round(rel.confidence * 100) / 100,
      };
      if (rel.relation_type === "supplier") suppliers.push(entry);
      else if (rel.relation_type === "customer") customers.push(entry);
      else if (rel.relation_type === "technology" || rel.relation_type === "co_occurrence") peers.push(entry);
    }

    return {
      ticker,
      chainPosition: company.chain_position,
      beneficiaryTier: company.beneficiary_tier,
      themes: execRows<{ name: string; lifecycle: string }>(themeRows).map(r => ({ name: r.name, lifecycle: r.lifecycle })),
      suppliers: suppliers.slice(0, 5),
      customers: customers.slice(0, 5),
      peers: peers.slice(0, 5),
      dataAvailable: true,
      source: "company_graph_db",
    };
  } catch (err) {
    console.warn("[get_supply_chain] error for", ticker, ":", err instanceof Error ? err.message : err);
    return base;
  }
}

// ── get_company_news ──────────────────────────────────────────────────────────

export interface CompanyNewsItem {
  date: string;
  title: string;
  url?: string | null;
  source?: string | null;
}

export interface CompanyNewsResult {
  ticker: string;
  items: CompanyNewsItem[];
  itemCount: number;
  /** "finmind_news_experimental" — availability depends on FinMind sponsor tier */
  source: string;
  /** "live" | "empty" | "unavailable" */
  state: "live" | "empty" | "unavailable";
  asOf: string | null;
  note: string;
}

/**
 * Fetches company-specific news for a ticker from FinMind TaiwanStockNews.
 *
 * IMPORTANT: This is an EXPERIMENTAL FinMind dataset — availability depends on sponsor tier.
 * Empty items=[] is a normal outcome (not an error). Callers must degrade gracefully.
 *
 * 【美股隔夜資料：未接入。VIX/DXY/10Y/WTI 均為 fail-open=0，不得以假資料推論。】
 *
 * Fail-open: returns state="unavailable" when token missing or upstream error.
 */
export async function getCompanyNews(ticker: string): Promise<CompanyNewsResult> {
  const base: CompanyNewsResult = {
    ticker,
    items: [],
    itemCount: 0,
    source: "finmind_news_experimental",
    state: "unavailable",
    asOf: null,
    note: "未嘗試取得",
  };

  try {
    const { getFinMindClient } = await import("../data-sources/finmind-client.js");
    const client = getFinMindClient();

    if (!client.hasToken()) {
      return {
        ...base,
        state: "unavailable",
        note: "【個股新聞：FinMind token 未設定，此維度無資料，請勿幻覺推論。】",
      };
    }

    // FinMind TaiwanStockNews: single-day only (omit end_date per FinMind constraint)
    const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = await client.getStockNews(ticker, startDate, "").catch(() => []);

    if (rows.length === 0) {
      return {
        ...base,
        state: "empty",
        asOf: new Date().toISOString(),
        note: "FinMind 個股新聞 experimental tier 本日無資料（空陣列屬正常，非錯誤）。分析時請標注此維度暫缺。",
      };
    }

    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    const items: CompanyNewsItem[] = sorted.map(r => ({
      date: r.date.slice(0, 10),
      title: r.title,
      url: r.url ?? null,
      source: r.source_name ?? null,
    }));

    return {
      ticker,
      items,
      itemCount: items.length,
      source: "finmind_news_experimental",
      state: "live",
      asOf: sorted[0]?.date ?? new Date().toISOString(),
      note: "ok",
    };
  } catch (err) {
    console.warn("[get_company_news] error for", ticker, ":", err instanceof Error ? err.message : err);
    return {
      ...base,
      state: "unavailable",
      note: "FinMind 個股新聞取得失敗，此維度暫缺，分析時標注。",
    };
  }
}

// ── get_news_top10 ────────────────────────────────────────────────────────────

/**
 * Returns today's AI-curated top-10 news from news-ai-selector.
 *
 * Freshness strategy: always prefer the NEWER of DB vs in-memory.
 * When v3 is loaded from a persisted DB run, the in-process news cache may
 * already be hours ahead of the trace. Checking DB directly ensures the LLM
 * sees the latest AI-curated selection (not a stale trace snapshot).
 *
 * Extra fields (why_matters, impact_tier, tags, rank) are forwarded so the
 * LLM can use them to calibrate theme strength instead of relying solely on
 * raw headline text.
 *
 * Fail-open: returns empty items when no data available.
 */
export async function getNewsTop10(): Promise<NewsTop10Result> {
  try {
    const { getNewsTop10ForRead, loadLatestSelectionFromDb } = await import("../news-ai-selector.js");

    // Pick the fresher of DB vs in-memory. DB is authoritative for timestamp.
    let best: Awaited<ReturnType<typeof getNewsTop10ForRead>> = null;

    try {
      const dbResult = await loadLatestSelectionFromDb();
      if (dbResult) best = dbResult;
    } catch {
      // DB unavailable — fall through to in-memory
    }

    try {
      const inMem = await getNewsTop10ForRead();
      if (inMem) {
        const dbTs = best ? new Date((best as { as_of: string }).as_of).getTime() : 0;
        const memTs = new Date((inMem as { as_of: string }).as_of).getTime();
        if (memTs > dbTs) best = inMem;
      }
    } catch {
      // ignore
    }

    if (!best) {
      return { items: [], asOf: null, runId: null, itemCount: 0 };
    }

    const items = (best.items ?? []) as Array<{
      id?: string;
      title?: string;
      headline?: string;
      ticker?: string | null;
      companyName?: string | null;
      sentiment?: string | null;
      source?: string | null;
      publishedAt?: string | null;
      why_matters?: string | null;
      impact_tier?: string | null;
      tags?: string[];
      rank?: number;
    }>;

    return {
      items: items.map(item => ({
        id: item.id ?? "",
        title: item.title ?? item.headline ?? "",
        ticker: item.ticker ?? null,
        companyName: item.companyName ?? null,
        // Surface impact_tier as sentiment so LLM can gauge importance
        sentiment: item.sentiment ?? item.impact_tier ?? null,
        source: item.source ?? null,
        publishedAt: item.publishedAt ?? null,
        // Forward AI-curated context fields so LLM can use theme strength signals
        ...(item.why_matters ? { why_matters: item.why_matters } : {}),
        ...(item.impact_tier ? { impact_tier: item.impact_tier } : {}),
        ...(item.tags?.length ? { tags: item.tags } : {}),
        ...(item.rank !== undefined ? { rank: item.rank } : {}),
      })),
      asOf: (best as { as_of?: string | null }).as_of ?? null,
      runId: (best as { run_id?: string | null }).run_id ?? null,
      itemCount: items.length,
    };
  } catch (err) {
    console.warn("[get_news_top10] error:", err instanceof Error ? err.message : err);
    return { items: [], asOf: null, runId: null, itemCount: 0 };
  }
}
