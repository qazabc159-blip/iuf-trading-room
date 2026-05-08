import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getFinMindStatus,
  getMarketIntelAnnouncements,
  type CompanyAnnouncement,
  type FinMindDatasetStatus,
  type FinMindSourceStatus,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { formatSourceTimestamp, latestIso, sourceFreshnessLabel } from "@/lib/source-freshness";

export const dynamic = "force-dynamic";

type IntelSelectedCompany = { id: string; ticker: string; name: string };

type IntelItem = CompanyAnnouncement & {
  companyId?: string;
  ticker: string;
  companyName: string;
};

type IntelState =
  | {
      state: "LIVE";
      items: IntelItem[];
      selected: IntelSelectedCompany[];
      updatedAt: string;
      source: string;
      failures: number;
    }
  | {
      state: "EMPTY";
      items: IntelItem[];
      selected: IntelSelectedCompany[];
      updatedAt: string;
      source: string;
      reason: string;
      failures: number;
    }
  | {
      state: "BLOCKED";
      items: IntelItem[];
      selected: IntelSelectedCompany[];
      updatedAt: string;
      source: string;
      reason: string;
      failures: number;
    };

type SourceHealth = {
  finmind: FinMindSourceStatus | null;
  error: string | null;
};

const ANNOUNCEMENT_DAYS = 30;
const MAX_QUERY_COMPANIES = 16;
const MAX_FEED_ROWS = 24;

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function stateLabel(state: IntelState["state"]) {
  if (state === "LIVE") return "可用";
  if (state === "EMPTY") return "無新訊";
  return "需登入";
}

function stateTone(state: IntelState["state"]) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function datasetTone(state: FinMindDatasetStatus["state"]) {
  if (state === "LIVE" || state === "READY") return "status-ok";
  if (state === "STALE" || state === "EMPTY" || state === "DEGRADED" || state === "FALLBACK") return "gold";
  return "status-bad";
}

function datasetStateLabel(state: FinMindDatasetStatus["state"]) {
  const labels: Record<FinMindDatasetStatus["state"], string> = {
    READY: "可用",
    LIVE: "可用",
    STALE: "需更新",
    EMPTY: "待補",
    FALLBACK: "參考",
    DEGRADED: "需確認",
    BLOCKED: "需處理",
    ERROR: "錯誤",
    MOCK: "需處理",
    CLOSED: "休市",
  };
  return labels[state] ?? state;
}

function formatCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-TW") : "--";
}

function categoryTone(category: string | null | undefined) {
  const key = (category ?? "").toLowerCase();
  if (/material|announcement|重大|公告/.test(key)) return "badge-green";
  if (/market|macro|index|news|台股|市場|大盤/.test(key)) return "badge-blue";
  return "badge-yellow";
}

function categoryLabel(category: string | null | undefined) {
  if (!category) return "市場情報";
  const key = category.toLowerCase();
  if (key.includes("material") || key.includes("announcement") || category.includes("重大")) return "重大訊息";
  if (key.includes("market") || key.includes("macro") || key.includes("index")) return "大盤";
  if (key.includes("news")) return "台股新聞";
  return category.replace(/[_-]/g, " ");
}

function intelTitleText(item: IntelItem) {
  return item.title?.trim() || "市場消息尚未提供標題";
}

function sourceCoverageLabel(result: IntelState) {
  if (result.state === "BLOCKED") return "需要登入";
  if (result.items.length === 0) return `近 ${ANNOUNCEMENT_DAYS} 天 0 筆`;
  const companies = new Set(
    result.items.map((item) => item.ticker).filter((ticker) => ticker && ticker !== "MARKET")
  ).size;
  return companies > 0 ? `${result.items.length} 筆 / ${companies} 檔` : `${result.items.length} 筆市場級`;
}

function userFacingReason(reason: string | null | undefined) {
  if (!reason) return "目前沒有可顯示的市場級消息。";
  if (/unauth|auth|session|login|cookie|401/i.test(reason)) return "登入狀態需要更新，重新登入後即可讀取市場情報。";
  if (/fetch failed|network|ECONNREFUSED|API_BASE|base url/i.test(reason)) return "市場情報連線失敗，請稍後重新整理。";
  return reason.replace(/token|secret|session|cookie|authorization|bearer|api[-_]?key|env|database|redis/gi, "資料來源");
}

async function loadSourceHealth(): Promise<SourceHealth> {
  try {
    return { finmind: (await getFinMindStatus()).data, error: null };
  } catch (error) {
    return { finmind: null, error: userFacingReason(friendlyDataError(error, "資料來源狀態讀取失敗")) };
  }
}

function marketIntelSourceLabel(source: "twse_announcements" | "finmind_stock_news" | "mixed" | "empty") {
  if (source === "twse_announcements") return "官方重大訊息";
  if (source === "finmind_stock_news") return "FinMind 台股新聞";
  if (source === "mixed") return "官方重大訊息 + FinMind 台股新聞";
  return "市場情報";
}

async function loadMarketIntel(): Promise<IntelState> {
  const updatedAt = new Date().toISOString();

  try {
    const aggregate = await getMarketIntelAnnouncements({
      days: ANNOUNCEMENT_DAYS,
      limit: MAX_FEED_ROWS,
      scope: "market",
    });
    const source = marketIntelSourceLabel(aggregate.data.source);
    const selected = aggregate.data.selected.slice(0, MAX_QUERY_COMPANIES);
    const items = aggregate.data.items.map((item) => ({
      ...item,
      ticker: item.ticker ?? "MARKET",
      companyName: item.companyName ?? (item.ticker && item.ticker !== "MARKET" ? item.ticker : "大盤"),
    }));

    if (items.length > 0) {
      return {
        state: "LIVE",
        items,
        selected,
        updatedAt: latestIso(items.map((item) => item.date)) ?? updatedAt,
        source,
        failures: aggregate.data.failures,
      };
    }

    return {
      state: "EMPTY",
      items: [],
      selected,
      updatedAt,
      source,
      reason: `近 ${ANNOUNCEMENT_DAYS} 天沒有市場級新聞或官方重大訊息。`,
      failures: aggregate.data.failures,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      items: [],
      selected: [],
      updatedAt,
      source: "市場情報",
      reason: userFacingReason(friendlyDataError(error, "市場情報讀取失敗")),
      failures: 1,
    };
  }
}

function datasetSummary(datasets: FinMindDatasetStatus[]) {
  const live = datasets.filter((item) => item.state === "LIVE" || item.state === "READY").length;
  const blocked = datasets.filter((item) => item.state === "BLOCKED" || item.state === "ERROR" || item.state === "MOCK").length;
  const stale = datasets.filter((item) => item.state === "STALE" || item.state === "DEGRADED" || item.state === "EMPTY" || item.state === "FALLBACK").length;
  return { live, blocked, stale };
}

function datasetDisplayLabel(dataset: FinMindDatasetStatus) {
  const labels: Record<string, string> = {
    TaiwanStockNews: "台股新聞",
    TaiwanStockInfo: "基本資料",
    TaiwanStockPrice: "日成交資料",
    TaiwanStockPriceAdj: "還原日 K",
    TaiwanStockMarketValue: "市值",
    TaiwanStockPER: "本益比 / 殖利率",
    TaiwanStockMonthRevenue: "月營收",
    TaiwanStockDividend: "股利",
  };
  return labels[dataset.key] ?? dataset.label;
}

function datasetReadinessCopy(dataset: FinMindDatasetStatus) {
  if (dataset.state === "LIVE" || dataset.state === "READY") return "已可支援頁面資料、篩選與研究流程。";
  if (dataset.state === "STALE" || dataset.state === "DEGRADED" || dataset.state === "FALLBACK") return "可作參考，盤面會以最新可用資料標示。";
  if (dataset.state === "EMPTY") return "尚無本地資料列，等待下一輪資料同步。";
  return userFacingReason(dataset.missingReason ?? dataset.degradedReason ?? dataset.blocker);
}

function intelHref(item: IntelItem) {
  if (item.url) return item.url;
  if (item.ticker && item.ticker !== "MARKET") return `/companies/${encodeURIComponent(item.ticker)}`;
  return "/market-intel";
}

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

function targetLabel(item: IntelItem) {
  if (!item.ticker || item.ticker === "MARKET") return "市場";
  return item.ticker;
}

function targetName(item: IntelItem) {
  if (!item.ticker || item.ticker === "MARKET") return "大盤";
  return item.companyName || item.ticker;
}

export default async function MarketIntelPage() {
  const [result, sourceHealth] = await Promise.all([loadMarketIntel(), loadSourceHealth()]);
  const freshness = result.state === "LIVE" ? sourceFreshnessLabel(result.updatedAt) : null;
  const statsAvailable = result.state !== "BLOCKED";
  const companyCount = new Set(
    result.items.map((item) => item.ticker).filter((ticker) => ticker && ticker !== "MARKET")
  ).size;
  const featured = result.items[0] ?? null;
  const feedItems = result.items.slice(featured ? 1 : 0);
  const finmind = sourceHealth.finmind;
  const datasets = finmind?.datasets ?? [];
  const summary = datasetSummary(datasets);
  const visibleDatasets = datasets.slice(0, 8);
  const channelState = finmind?.state === "LIVE_READY" ? "可用" : finmind ? "需注意" : "需登入";
  const channelTone = finmind?.state === "LIVE_READY" ? "status-ok" : finmind ? "gold" : "status-bad";
  const focusChips = result.selected.length > 0
    ? result.selected.slice(0, 8)
    : [
        { id: "market-taiex", ticker: "TAIEX", name: "加權指數" },
        { id: "market-sector", ticker: "SECTOR", name: "類股" },
        { id: "market-fund", ticker: "FLOW", name: "法人資金" },
        { id: "market-macro", ticker: "MACRO", name: "總經" },
      ];

  return (
    <PageFrame
      code="MKT"
      title="市場情報"
      sub="大盤新聞、官方重大訊息與資料通道"
      note="這頁只收市場級消息與官方重大訊息；個股雜訊不進首頁工作流。"
    >
      <MetricStrip
        columns={5}
        cells={[
          { label: "情報狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "市場級消息", value: statsAvailable ? result.items.length : "--", tone: result.items.length > 0 ? "status-ok" : "muted" },
          { label: "涵蓋標的", value: statsAvailable ? (companyCount > 0 ? `${companyCount} 檔` : "大盤") : "--" },
          { label: "資料通道", value: channelState, tone: channelTone },
          { label: "更新", value: formatSourceTimestamp(result.updatedAt), tone: freshness?.tone },
        ]}
      />

      <section className="intel-command-deck">
        <div className="intel-command-copy">
          <div className="tg gold">MARKET INTEL / 台股大盤情報</div>
          <h2>先看大盤消息，再決定要不要進公司研究。</h2>
          <p>
            這裡接官方重大訊息與 FinMind 台股新聞，並用市場詞篩掉個股雜訊。內容只作為研究入口，不提供買賣建議。
          </p>
          <div className="intel-chip-rail" aria-label="市場情報焦點">
            {focusChips.map((item) => (
              item.ticker !== "TAIEX" && item.ticker !== "SECTOR" && item.ticker !== "FLOW" && item.ticker !== "MACRO" ? (
                <Link href={`/companies/${encodeURIComponent(item.ticker)}`} key={item.id} className="intel-chip">
                  <span>{item.ticker}</span>
                  <small>{item.name}</small>
                </Link>
              ) : (
                <span key={item.id} className="intel-chip">
                  <span>{item.ticker}</span>
                  <small>{item.name}</small>
                </span>
              )
            ))}
          </div>
        </div>
        <aside className="intel-source-card">
          <span className={`badge ${result.state === "LIVE" ? "badge-green" : result.state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>
            {stateLabel(result.state)}
          </span>
          <div>
            <span className="tg soft">來源</span>
            <strong>{result.source}</strong>
          </div>
          <div>
            <span className="tg soft">範圍</span>
            <strong>{sourceCoverageLabel(result)}</strong>
          </div>
          <div>
            <span className="tg soft">取用</span>
            <strong>{result.failures > 0 ? "部分來源需重試" : "可讀"}</strong>
          </div>
          <p>
            {result.state === "LIVE"
              ? "大盤消息已整理成研究入口；點開新聞或公司代號可回到對應頁面。"
              : userFacingReason(result.reason)}
          </p>
        </aside>
      </section>

      <section className="intel-feed-surface">
        <div className="intel-feed-head">
          <div>
            <div className="tg gold">
              市場訊息 / {formatSourceTimestamp(result.updatedAt)}
              {freshness && <span className={`tg ${freshness.tone}`}> / {freshness.label}</span>}
            </div>
            <h2>今日要先讀的市場消息</h2>
          </div>
          <span className={`tg ${stateTone(result.state)}`}>{sourceCoverageLabel(result)}</span>
        </div>

        {result.state === "LIVE" ? (
          <div className="intel-feed-list">
            {featured && (
              <Link
                href={intelHref(featured)}
                className="intel-feature-card"
                target={isExternalHref(intelHref(featured)) ? "_blank" : undefined}
                rel={isExternalHref(intelHref(featured)) ? "noreferrer" : undefined}
              >
                <span className={`badge ${categoryTone(featured.category)}`}>{categoryLabel(featured.category)}</span>
                <strong>{intelTitleText(featured)}</strong>
                <span className="tc soft">
                  {targetLabel(featured)} / {targetName(featured)} / {formatDate(featured.date)}
                </span>
              </Link>
            )}
            {feedItems.map((item) => {
              const href = intelHref(item);
              const external = isExternalHref(href);
              return (
                <Link
                  href={href}
                  className="intel-feed-row"
                  key={`${item.ticker}-${item.id}`}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                >
                  <span className="tg soft">{formatDate(item.date)}</span>
                  <span className="tg gold">{targetLabel(item)}</span>
                  <span className="intel-feed-title">
                    {intelTitleText(item)}
                    <small>{targetName(item)}</small>
                  </span>
                  <span className={`badge ${categoryTone(item.category)}`}>{categoryLabel(item.category)}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="intel-empty-state">
            <strong>{stateLabel(result.state)}</strong>
            <p>{userFacingReason(result.reason)}</p>
            <span className="tg soft">篩選範圍：官方重大訊息、台股大盤、類股、法人、匯率與總經消息。</span>
          </div>
        )}
      </section>

      <section className="intel-feed-surface">
        <div className="intel-feed-head">
          <div>
            <div className="tg gold">DATA READINESS / 資料通道</div>
            <h2>市場頁面使用的資料集</h2>
          </div>
          <span className={`tg ${channelTone}`}>
            {finmind ? `可用 ${summary.live} / 注意 ${summary.stale} / 需處理 ${summary.blocked}` : "需要登入"}
          </span>
        </div>

        {finmind ? (
          <div className="intel-dataset-grid">
            {visibleDatasets.map((dataset) => (
              <div className="intel-dataset-card" key={dataset.key}>
                <div>
                  <span className="tg gold">{datasetDisplayLabel(dataset)}</span>
                  <span className={`badge ${datasetTone(dataset.state)}`}>{datasetStateLabel(dataset.state)}</span>
                </div>
                <strong>{datasetReadinessCopy(dataset)}</strong>
                <small>
                  最新 {dataset.latestDate ?? formatSourceTimestamp(dataset.lastFetchTs)} / 筆數 {formatCount(dataset.rowCount)}
                </small>
              </div>
            ))}
            {visibleDatasets.length === 0 && (
              <div className="intel-empty-state">
                <strong>沒有資料集狀態</strong>
                <p>後端尚未回傳 FinMind 資料集列表。</p>
              </div>
            )}
          </div>
        ) : (
          <div className="intel-empty-state">
            <strong>需要登入</strong>
            <p>{sourceHealth.error ?? "重新登入後即可讀取資料通道狀態。"}</p>
          </div>
        )}
      </section>
    </PageFrame>
  );
}
