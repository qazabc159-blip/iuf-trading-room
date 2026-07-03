import { PageFrame, Panel } from "@/components/PageFrame";
import { DataStateBadge } from "@/components/DataStateBadge";
import {
  getCompanies,
  getCompanyKBar,
  getCompanyOhlcv,
  getCompanyQuoteRealtime,
  getEffectiveQuotes,
  type CompanyRealtimeQuote,
  type EffectiveMarketQuote,
  type FinMindKBarRow,
  type OhlcvBar,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { OhlcvCandlestickChart } from "../companies/[symbol]/OhlcvCandlestickChart";

type KlineState = {
  state: "LIVE" | "EMPTY" | "BLOCKED";
  bars: OhlcvBar[];
  reason: string;
  kbarRows: FinMindKBarRow[];
  kbarState: "LIVE" | "EMPTY" | "BLOCKED";
  kbarReason: string;
  kbarDate: string;
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

function quoteSourceLabel(source: EffectiveMarketQuote["selectedSource"]) {
  if (!source) return "無";
  if (source === "kgi") return "凱基";
  if (source === "paper") return "模擬";
  if (source === "tradingview") return "TradingView";
  if (source === "manual") return "手動資料";
  return source;
}

function freshnessLabel(status: EffectiveMarketQuote["freshnessStatus"]) {
  if (status === "fresh") return "即時";
  if (status === "stale") return "偏舊";
  return "缺資料";
}

function reasonLabel(reason: string) {
  if (reason === "none") return "";
  if (reason === "no_quote") return "無報價";
  if (reason === "no_fresh_quote") return "無新鮮報價";
  if (reason === "age_exceeded") return "資料逾時";
  if (reason === "missing_last") return "缺成交價";
  if (reason === "provider_unavailable") return "資料源未連線";
  if (reason === "higher_priority_stale") return "優先資料偏舊";
  if (reason === "higher_priority_missing") return "優先資料缺漏";
  if (reason === "higher_priority_unavailable") return "優先資料源未連線";
  return reason;
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
  const reasons = item.reasons.map(reasonLabel).filter(Boolean);

  return (
    <Panel
      code="QTE-LIVE"
      title={`${item.symbol} ${item.market}`}
      right={
        <span className="source-line" style={{ margin: 0 }}>
          <span className={`badge ${readinessBadge(item.readiness)}`}>{readinessLabel(item.readiness)}</span>
          <span>來源：{quoteSourceLabel(item.selectedSource)}</span>
          <span>新鮮度：{freshnessLabel(item.freshnessStatus)}</span>
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

      {reasons.length > 0 && (
        <div className="quote-reason-list">
          {reasons.map((reason) => (
            <span className="badge" key={reason}>{reason}</span>
          ))}
        </div>
      )}
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
  const today = new Date().toISOString().slice(0, 10);
  try {
    const companies = await getCompanies();
    const company = companies.data.find((item) => item.ticker.toUpperCase() === symbol) ?? null;
    if (!company) {
      return {
        state: "EMPTY",
        bars: [],
        reason: `查無 ${symbol} 公司資料，無法讀取 K 線。`,
        kbarRows: [],
        kbarState: "EMPTY",
        kbarReason: `查無 ${symbol} 公司資料，無法讀取分 K。`,
        kbarDate: today,
      };
    }

    let dailyState: KlineState["state"] = "EMPTY";
    let dailyBars: OhlcvBar[] = [];
    let dailyReason = "此股票目前沒有可用的正式 K 線資料。";

    try {
      const response = await getCompanyOhlcv(company.id, { interval: "1d" });
      dailyBars = response.filter((bar) => bar.source !== "mock");
      if (dailyBars.length > 0) {
        dailyState = "LIVE";
        dailyReason = `已讀取 ${dailyBars.length} 根正式 K 線。`;
      }
    } catch (error) {
      dailyState = "BLOCKED";
      dailyReason = `K 線資料暫時無法讀取：${friendlyDataError(error)}`;
    }

    const kbarDate = dailyBars.at(-1)?.dt ?? today;
    let kbarRows: FinMindKBarRow[] = [];
    let kbarState: KlineState["kbarState"] = "EMPTY";
    let kbarReason = "FinMind 分 K 尚未回傳資料。";
    let resolvedKbarDate = kbarDate;
    try {
      const kbar = (await getCompanyKBar(company.id, kbarDate, { days: 5 })).data;
      kbarRows = kbar.rows;
      kbarState = kbar.state;
      kbarReason = kbar.reason ?? (kbar.rows.length > 0 ? "已取得 FinMind Sponsor 分 K。" : "FinMind 分 K 尚未回傳資料。");
      resolvedKbarDate = kbar.date;
    } catch (error) {
      kbarState = "BLOCKED";
      kbarReason = `FinMind 分 K 暫時無法讀取：${friendlyDataError(error)}`;
    }

    return {
      state: dailyState,
      bars: dailyBars,
      reason: dailyReason,
      kbarRows,
      kbarState,
      kbarReason,
      kbarDate: resolvedKbarDate,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      bars: [],
      reason: `公司清單暫時無法讀取：${friendlyDataError(error)}`,
      kbarRows: [],
      kbarState: "BLOCKED",
      kbarReason: `公司清單暫時無法讀取：${friendlyDataError(error)}`,
      kbarDate: today,
    };
  }
}

/** "2026-06-09" → "06/09"; null when the backend didn't supply a data date. */
function eodDataDateLabel(realtime: CompanyRealtimeQuote): string | null {
  const iso = realtime.dataDate;
  if (!iso || iso.length < 10) return null;
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

function realtimeSourceText(realtime: CompanyRealtimeQuote) {
  if (realtime.source === "kgi-gateway") return "KGI SIM 即時";
  if (realtime.source === "twse_intraday") return "TWSE MIS 盤中";
  // TWSE EOD can lag a session — label with the data's own trading date, never「今日」.
  const d = eodDataDateLabel(realtime);
  const dateSuffix = d ? `（${d} 收盤資料）` : "";
  if (realtime.referenceReason === "pre_open_reference") return `盤前收盤參考${dateSuffix}`;
  if (realtime.referenceReason === "post_close_reference") return `盤後收盤參考${dateSuffix}`;
  if (realtime.referenceReason === "kgi_unavailable_eod_fallback") return `KGI 不可用，使用 TWSE 收盤參考${dateSuffix}`;
  return `TWSE 收盤參考${dateSuffix}`;
}

function realtimeFreshnessText(realtime: CompanyRealtimeQuote) {
  if (realtime.freshness === "fresh") return "即時";
  const d = eodDataDateLabel(realtime);
  if (realtime.referenceReason === "pre_open_reference") return "盤前參考";
  if (realtime.referenceReason === "post_close_reference") return "盤後參考";
  if (realtime.freshness === "stale") return d ? `${d} 收盤` : "收盤參考";
  return "無資料";
}

function KgiRealtimePanel({ realtime }: { realtime: CompanyRealtimeQuote | null }) {
  if (!realtime || realtime.state === "BLOCKED" || realtime.state === "NO_DATA") {
    const reason = realtime?.reason ?? realtime?.note ?? "目前沒有可用報價來源。";
    return (
      <Panel code="QTE-REALTIME" title="即時報價" right="暫停">
        <div className="state-panel">
          <DataStateBadge state="empty" label="報價不可用" testId="quote-realtime-empty-badge" />
          <span className="tg soft">KGI / TWSE 來源都沒有可顯示資料</span>
          <span className="state-reason">{reason}</span>
        </div>
      </Panel>
    );
  }

  const sourceBadge = realtime.state === "LIVE" ? "badge-green" : "badge-yellow";
  const sourceLabel = realtimeFreshnessText(realtime);

  return (
    <Panel
      code="QTE-REALTIME"
      title="即時報價"
      right={
        <span className="source-line" style={{ margin: 0 }}>
          <span className={`badge ${sourceBadge}`}>{sourceLabel}</span>
          <span>{realtimeSourceText(realtime)}</span>
          <span>更新 {formatDateTime(realtime.updatedAt)}</span>
        </span>
      }
    >
      <div className="quote-snapshot-grid">
        <div>
          <span className="tg soft">成交價</span>
          <b className="num">{fmtNumber(realtime.lastPrice)}</b>
        </div>
        <div>
          <span className="tg soft">買價</span>
          <b className="num up">{fmtNumber(realtime.bid)}</b>
        </div>
        <div>
          <span className="tg soft">賣價</span>
          <b className="num down">{fmtNumber(realtime.ask)}</b>
        </div>
        <div>
          <span className="tg soft">成交量</span>
          <b className="num">{realtime.volume !== null ? realtime.volume.toLocaleString("zh-TW") : "--"}</b>
        </div>
        <div>
          <span className="tg soft">狀態</span>
          <b className="tg">{sourceLabel}</b>
        </div>
      </div>
      {realtime.dataDate || realtime.note || realtime.reason ? (
        <div className="state-reason" style={{ marginTop: 12 }}>
          {eodDataDateLabel(realtime)
            ? `顯示 TWSE ${eodDataDateLabel(realtime)} 收盤資料，非今日即時行情。`
            : realtime.note ?? realtime.reason}
        </div>
      ) : null}
    </Panel>
  );
}

function LegacyKgiRealtimePanel({ realtime }: { realtime: CompanyRealtimeQuote | null }) {
  if (!realtime || realtime.state === "BLOCKED" || realtime.state === "NO_DATA") {
    const reason = realtime?.reason ?? (realtime ? "此股暫無即時報價資料。" : "盤後即時報價暫停，請於開盤時段查看。");
    return (
      <Panel code="QTE-KGI" title="即時報價" right="暫無報價">
        <div className="state-panel">
          <span className="badge badge-red">等待即時</span>
          <span className="tg soft">不顯示假報價</span>
          <span className="state-reason">{reason}</span>
        </div>
      </Panel>
    );
  }

  const sourceBadge = realtime.state === "LIVE" ? "badge-green" : "badge-yellow";
  const sourceLabel = realtime.state === "LIVE" ? "即時" : realtime.state === "CLOSE" ? "今日收盤" : "略舊";

  return (
    <Panel
      code="QTE-KGI"
      title="即時報價"
      right={
        <span className="source-line" style={{ margin: 0 }}>
          <span className={`badge ${sourceBadge}`}>{sourceLabel}</span>
          <span>更新 {formatDateTime(realtime.updatedAt)}</span>
        </span>
      }
    >
      <div className="quote-snapshot-grid">
        <div>
          <span className="tg soft">即時成交</span>
          <b className="num">{realtime.lastPrice !== null ? realtime.lastPrice.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"}</b>
        </div>
        <div>
          <span className="tg soft">買價</span>
          <b className="num up">{realtime.bid !== null ? realtime.bid.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"}</b>
        </div>
        <div>
          <span className="tg soft">賣價</span>
          <b className="num down">{realtime.ask !== null ? realtime.ask.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"}</b>
        </div>
        <div>
          <span className="tg soft">成交量</span>
          <b className="num">{realtime.volume !== null ? realtime.volume.toLocaleString("zh-TW") : "--"}</b>
        </div>
        <div>
          <span className="tg soft">新鮮度</span>
          <b className="tg">{realtime.freshness === "fresh" ? "新鮮" : realtime.freshness === "stale" ? "略舊" : "無資料"}</b>
        </div>
      </div>
    </Panel>
  );
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

  // Parallel: kline + effective quote + companies (need ID for realtime)
  const [klineResult, effectiveResult, companiesResult] = await Promise.allSettled([
    loadQuoteKline(symbol),
    getEffectiveQuotes({ symbols: symbol, includeStale: true, limit: 1 }),
    getCompanies(),
  ]);

  if (effectiveResult.status === "fulfilled") {
    generatedAt = effectiveResult.value.data.generatedAt;
    item = effectiveResult.value.data.items[0] ?? null;
  } else {
    error = friendlyDataError(effectiveResult.reason, "報價請求失敗。");
  }

  const kline = klineResult.status === "fulfilled" ? klineResult.value : {
    state: "BLOCKED" as const,
    bars: [],
    reason: friendlyDataError(klineResult.reason, "K 線資料暫時無法讀取。"),
    kbarRows: [],
    kbarState: "BLOCKED" as const,
    kbarReason: "K 線資料暫時無法讀取。",
    kbarDate: new Date().toISOString().slice(0, 10),
  };

  // KGI realtime quote: resolve company ID first, then fetch.
  let realtimeQuote: CompanyRealtimeQuote | null = null;
  if (companiesResult.status === "fulfilled") {
    const company = companiesResult.value.data.find((c) => c.ticker.toUpperCase() === symbol) ?? null;
    if (company) {
      realtimeQuote = await getCompanyQuoteRealtime(company.id);
    }
  }

  return (
    <PageFrame
      code="QTE"
      title={`台股報價 ${symbol}`}
      sub="報價 / K 線 / 五檔與逐筆"
      note="此頁只顯示正式資料；凱基即時連線時顯示即時報價；未接上的欄位會清楚標示暫停。"
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

      {/* KGI EC2 realtime — always first, state honest, never mock */}
      <KgiRealtimePanel realtime={realtimeQuote} />

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
        <OhlcvCandlestickChart
          bars={kline.bars}
          kbarRows={kline.kbarRows}
          kbarState={kline.kbarState}
          kbarReason={kline.kbarReason}
          kbarDate={kline.kbarDate}
          symbol={symbol}
          sourceState={kline.state}
          sourceReason={kline.reason}
        />
        <div>
          <BlockedMarketPanel
            code="QTE-BA"
            title="五檔委買委賣"
            reason="盤後暫停，下一交易日 09:00 恢復。"
          />
          <BlockedMarketPanel
            code="QTE-T"
            title="逐筆成交"
            reason="盤後暫停，下一交易日 09:00 恢復。"
          />
        </div>
      </div>
    </PageFrame>
  );
}
