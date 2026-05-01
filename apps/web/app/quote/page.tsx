import { PageFrame, Panel } from "@/components/PageFrame";
import { getCompanies, getCompanyOhlcv, getEffectiveQuotes, type EffectiveMarketQuote, type OhlcvBar } from "@/lib/api";
import { OhlcvCandlestickChart } from "../companies/[symbol]/OhlcvCandlestickChart";

type KlineState = {
  state: "LIVE" | "EMPTY" | "BLOCKED";
  bars: OhlcvBar[];
  reason: string;
};

function fmtNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "NOT SET";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function readinessBadge(readiness: EffectiveMarketQuote["readiness"]) {
  if (readiness === "ready") return "badge-green";
  if (readiness === "degraded") return "badge-yellow";
  return "badge-red";
}

function QuoteStatePanel({
  state,
  reason,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
}) {
  return (
    <Panel code={`QTE-${state}`} title={state} right="Quote source">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{state}</span>
        <span className="tg soft">Source: GET /api/v1/market-data/effective-quotes</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

function QuoteSnapshot({ item }: { item: EffectiveMarketQuote }) {
  const quote = item.selectedQuote;
  const reasons = item.reasons.length > 0 ? item.reasons : ["none"];

  return (
    <Panel
      code="QTE-LIVE"
      title={`${item.symbol} ${item.market}`}
      right={
        <span className="source-line" style={{ margin: 0 }}>
          <span className={`badge ${readinessBadge(item.readiness)}`}>{item.readiness.toUpperCase()}</span>
          <span>Source: {item.selectedSource ?? "NONE"}</span>
          <span>Freshness: {item.freshnessStatus}</span>
        </span>
      }
    >
      {quote ? (
        <div className="quote-snapshot-grid">
          <div>
            <span className="tg soft">LAST</span>
            <b className="num">{fmtNumber(quote.last)}</b>
          </div>
          <div>
            <span className="tg soft">BID</span>
            <b className="num up">{fmtNumber(quote.bid)}</b>
          </div>
          <div>
            <span className="tg soft">ASK</span>
            <b className="num down">{fmtNumber(quote.ask)}</b>
          </div>
          <div>
            <span className="tg soft">CHANGE</span>
            <b className="num">{fmtNumber(quote.changePct)}%</b>
          </div>
          <div>
            <span className="tg soft">VOLUME</span>
            <b className="num">{fmtNumber(quote.volume, 0)}</b>
          </div>
          <div>
            <span className="tg soft">UPDATED</span>
            <b className="tg">{formatDateTime(quote.timestamp)}</b>
          </div>
        </div>
      ) : (
        <div className="state-panel">
          <span className="badge badge-red">BLOCKED</span>
          <span className="state-reason">No selected quote is available for this symbol.</span>
        </div>
      )}

      <div className="quote-reason-list">
        {reasons.map((reason) => (
          <span className="badge" key={reason}>{reason}</span>
        ))}
      </div>
    </Panel>
  );
}

function BlockedMarketPanel({
  code,
  title,
  reason,
}: {
  code: string;
  title: string;
  reason: string;
}) {
  return (
    <Panel code={code} title={title} right="contract required">
      <div className="state-panel">
        <span className="badge badge-red">BLOCKED</span>
        <span className="tg soft">Owner: Jason/Elva.</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

async function loadQuoteKline(symbol: string): Promise<KlineState> {
  try {
    const companies = await getCompanies();
    const company = companies.data.find((item) => item.ticker.toUpperCase() === symbol) ?? null;
    if (!company) {
      return {
        state: "EMPTY",
        bars: [],
        reason: `GET /api/v1/companies returned no company row for ${symbol}; K-line lookup is not evaluated.`,
      };
    }

    try {
      const response = await getCompanyOhlcv(company.id, { interval: "1d" });
      const bars = response.filter((bar) => bar.source !== "mock");
      if (bars.length === 0) {
        return {
          state: "EMPTY",
          bars: [],
          reason: "GET /api/v1/companies/:id/ohlcv returned zero production OHLCV bars for this symbol.",
        };
      }
      return {
        state: "LIVE",
        bars,
        reason: `GET /api/v1/companies/:id/ohlcv returned ${bars.length} production bars.`,
      };
    } catch (error) {
      return {
        state: "BLOCKED",
        bars: [],
        reason: `GET /api/v1/companies/:id/ohlcv failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    return {
      state: "BLOCKED",
      bars: [],
      reason: `GET /api/v1/companies failed before K-line lookup: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export default async function QuotePage({
  searchParams,
}: {
  searchParams?: Promise<{ symbol?: string }>;
}) {
  const params = await searchParams;
  const symbol = (params?.symbol?.trim() || "2330").toUpperCase();
  let item: EffectiveMarketQuote | null = null;
  let generatedAt: string | null = null;
  let error: string | null = null;
  const kline = await loadQuoteKline(symbol);

  try {
    const response = await getEffectiveQuotes({ symbols: symbol, includeStale: true, limit: 1 });
    generatedAt = response.data.generatedAt;
    item = response.data.items[0] ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : "effective quote request failed";
  }

  return (
    <PageFrame
      code="QTE"
      title={`Quote ${symbol}`}
      sub="Effective quote from production market-data policy"
      note="[QTE] No deterministic bid/ask, ticks, or K-line mock is rendered."
    >
      <Panel code="QTE-SRC" title="Symbol lookup" right={generatedAt ? `Generated ${formatDateTime(generatedAt)}` : "market-data"}>
        <form action="/quote" className="filter-row">
          <input
            name="symbol"
            defaultValue={symbol}
            style={{
              flex: "0 1 220px",
              minHeight: 34,
              border: "1px solid var(--night-rule-strong)",
              background: "var(--night)",
              color: "var(--night-ink)",
              fontFamily: "var(--mono)",
              padding: "0 10px",
              outline: "none",
            }}
            placeholder="2330"
          />
          <button className="mini-button" type="submit">LOAD</button>
        </form>
      </Panel>

      {error && (
        <QuoteStatePanel
          state="BLOCKED"
          reason={`API request failed. Owner: Jason/Elva. Detail: ${error}`}
        />
      )}

      {!error && !item && (
        <QuoteStatePanel
          state="EMPTY"
          reason="The effective quote API returned zero rows for this symbol. No fallback quote is rendered."
        />
      )}

      {!error && item && <QuoteSnapshot item={item} />}

      <div className="company-grid">
        <OhlcvCandlestickChart bars={kline.bars} symbol={symbol} sourceState={kline.state} sourceReason={kline.reason} />
        <div>
          <BlockedMarketPanel
            code="QTE-BA"
            title="Bid/ask depth"
            reason="No verified production depth contract is wired for this page yet. The old deterministic ladder has been removed."
          />
          <BlockedMarketPanel
            code="QTE-T"
            title="Tick tape"
            reason="KGI readonly ticks are still blocked pending endpoint availability and Jason contract confirmation. The old generated tick tape has been removed."
          />
        </div>
      </div>
    </PageFrame>
  );
}
