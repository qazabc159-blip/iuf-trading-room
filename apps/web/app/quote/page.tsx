import { PageFrame, Panel } from "@/components/PageFrame";
import { getCompanies, getCompanyOhlcv, getEffectiveQuotes, type EffectiveMarketQuote, type OhlcvBar } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { OhlcvCandlestickChart } from "../companies/[symbol]/OhlcvCandlestickChart";

type KlineState = {
  state: "LIVE" | "EMPTY" | "BLOCKED";
  bars: OhlcvBar[];
  reason: string;
};

function fmtNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "未設定";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function stateLabel(state: "LIVE" | "EMPTY" | "BLOCKED") {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function readinessLabel(readiness: EffectiveMarketQuote["readiness"]) {
  if (readiness === "ready") return "正常";
  if (readiness === "degraded") return "降級";
  return "暫停";
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
    <Panel code={`QTE-${state}`} title={stateLabel(state)} right="報價來源">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{stateLabel(state)}</span>
        <span className="tg soft">正式報價資料</span>
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
          <span className={`badge ${readinessBadge(item.readiness)}`}>{readinessLabel(item.readiness)}</span>
          <span>來源：{item.selectedSource ?? "無"}</span>
          <span>新鮮度：{item.freshnessStatus}</span>
        </span>
      }
    >
      {quote ? (
        <div className="quote-snapshot-grid">
          <div>
            <span className="tg soft">成交</span>
            <b className="num">{fmtNumber(quote.last)}</b>
          </div>
          <div>
            <span className="tg soft">買價</span>
            <b className="num up">{fmtNumber(quote.bid)}</b>
          </div>
          <div>
            <span className="tg soft">賣價</span>
            <b className="num down">{fmtNumber(quote.ask)}</b>
          </div>
          <div>
            <span className="tg soft">漲跌幅</span>
            <b className="num">{fmtNumber(quote.changePct)}%</b>
          </div>
          <div>
            <span className="tg soft">成交量</span>
            <b className="num">{fmtNumber(quote.volume, 0)}</b>
          </div>
          <div>
            <span className="tg soft">更新</span>
            <b className="tg">{formatDateTime(quote.timestamp)}</b>
          </div>
        </div>
      ) : (
        <div className="state-panel">
          <span className="badge badge-red">暫停</span>
          <span className="state-reason">此股票目前沒有可用的正式報價。</span>
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
    <Panel code={code} title={title} right="待資料源">
      <div className="state-panel">
        <span className="badge badge-red">暫停</span>
        <span className="tg soft">等待即時資料源接上後啟用</span>
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
        reason: `查無 ${symbol} 公司資料，無法讀取 K 線。`,
      };
    }

    try {
      const response = await getCompanyOhlcv(company.id, { interval: "1d" });
      const bars = response.filter((bar) => bar.source !== "mock");
      if (bars.length === 0) {
        return {
          state: "EMPTY",
          bars: [],
          reason: "此股票目前沒有可用的正式 K 線資料。",
        };
      }
      return {
        state: "LIVE",
        bars,
        reason: `已讀取 ${bars.length} 根正式 K 線。`,
      };
    } catch (error) {
      return {
        state: "BLOCKED",
        bars: [],
        reason: `K 線資料暫時無法讀取：${friendlyDataError(error)}`,
      };
    }
  } catch (error) {
    return {
      state: "BLOCKED",
      bars: [],
      reason: `公司清單暫時無法讀取：${friendlyDataError(error)}`,
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
    error = friendlyDataError(err, "報價請求失敗。");
  }

  return (
    <PageFrame
      code="QTE"
      title={`台股報價 ${symbol}`}
      sub="報價 / K 線 / 五檔與逐筆"
      note="此頁只顯示正式資料；尚未接上的即時五檔與逐筆會清楚標示暫停。"
    >
      <Panel code="QTE-SRC" title="股票查詢" right={generatedAt ? `更新 ${formatDateTime(generatedAt)}` : "市場資料"}>
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
          <button className="mini-button" type="submit">查詢</button>
        </form>
      </Panel>

      {error && (
        <QuoteStatePanel
          state="BLOCKED"
          reason={`報價暫時無法讀取：${error}`}
        />
      )}

      {!error && !item && (
        <QuoteStatePanel
          state="EMPTY"
          reason="此股票目前沒有可用的正式報價；不使用假資料補值。"
        />
      )}

      {!error && item && <QuoteSnapshot item={item} />}

      <div className="company-grid">
        <OhlcvCandlestickChart bars={kline.bars} symbol={symbol} sourceState={kline.state} sourceReason={kline.reason} />
        <div>
          <BlockedMarketPanel
            code="QTE-BA"
            title="五檔委買委賣"
            reason="凱基唯讀五檔資料尚未接上；目前不顯示假五檔。"
          />
          <BlockedMarketPanel
            code="QTE-T"
            title="逐筆成交"
            reason="逐筆資料等待凱基唯讀串流或後端快取啟用；目前不顯示假逐筆。"
          />
        </div>
      </div>
    </PageFrame>
  );
}
