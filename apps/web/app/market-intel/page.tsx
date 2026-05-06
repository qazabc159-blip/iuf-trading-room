import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getCompanies,
  getCompanyAnnouncements,
  getFinMindStatus,
  getStrategyIdeas,
  type CompanyAnnouncement,
  type FinMindDatasetStatus,
  type FinMindSourceStatus,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { formatSourceTimestamp, latestIso, sourceFreshnessLabel } from "@/lib/source-freshness";

export const dynamic = "force-dynamic";

type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type IdeaView = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];

type IntelItem = CompanyAnnouncement & {
  companyId: string;
  ticker: string;
  companyName: string;
};

type IntelState =
  | {
      state: "LIVE";
      items: IntelItem[];
      selected: CompanyRow[];
      updatedAt: string;
      source: string;
      failures: number;
    }
  | {
      state: "EMPTY";
      items: IntelItem[];
      selected: CompanyRow[];
      updatedAt: string;
      source: string;
      reason: string;
      failures: number;
    }
  | {
      state: "BLOCKED";
      items: IntelItem[];
      selected: CompanyRow[];
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
const MAX_FEED_ROWS = 60;

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
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function stateTone(state: IntelState["state"]) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function datasetTone(state: FinMindDatasetStatus["state"]) {
  if (state === "LIVE" || state === "READY") return "status-ok";
  if (state === "STALE" || state === "EMPTY" || state === "DEGRADED") return "gold";
  return "status-bad";
}

function datasetStateLabel(state: FinMindDatasetStatus["state"]) {
  const labels: Record<FinMindDatasetStatus["state"], string> = {
    READY: "已接",
    LIVE: "正常",
    STALE: "過期",
    EMPTY: "無資料",
    FALLBACK: "備援",
    DEGRADED: "降級",
    BLOCKED: "阻擋",
    ERROR: "錯誤",
    MOCK: "禁止",
    CLOSED: "收盤",
  };
  return labels[state] ?? state;
}

function categoryTone(category: string | null | undefined) {
  const key = (category ?? "").toLowerCase();
  if (/dividend|股利|配息|配股/.test(key)) return "badge-yellow";
  if (/financial|revenue|eps|earnings|財報|營收/.test(key)) return "badge-green";
  if (/material|announcement|news|公告|重大|訊息/.test(key)) return "badge-blue";
  return "badge";
}

function categoryLabel(category: string | null | undefined) {
  if (!category) return "重大訊息";
  const key = category.toLowerCase();
  if (key === "earnings" || key === "financial") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "theme") return "主題";
  if (key === "industry") return "產業";
  if (key === "supply_chain") return "供應鏈";
  if (key === "technical") return "技術面";
  if (key === "fundamental") return "基本面";
  if (key === "material" || key === "announcement") return "重大訊息";
  return category.replace(/[_-]/g, " ");
}

function hasBrokenText(value: string | null | undefined) {
  if (!value) return false;
  return /[\uFFFD\uE000-\uF8FF]|undefined|null/i.test(value);
}

function intelTitleText(item: IntelItem) {
  const raw = item.title?.trim();
  if (!raw) return "重大訊息標題未回傳";
  if (hasBrokenText(raw)) return "標題編碼異常，請回公司頁查看來源狀態";
  return raw;
}

function sourceCoverageLabel(result: IntelState) {
  if (result.state === "BLOCKED") return "來源暫停";
  if (result.items.length === 0) return `近 ${ANNOUNCEMENT_DAYS} 天 0 筆`;
  return `${result.items.length} 筆 / ${new Set(result.items.map((item) => item.ticker)).size} 檔`;
}

function missingReasonText(reason: string | null | undefined) {
  if (!reason) return "後端尚未回報原因";
  const labels: Record<string, string> = {
    no_token: "FinMind token 未設定",
    not_queried: "排程尚未查詢",
    experimental_may_degrade: "資料集仍在觀察，可能尚未穩定回傳",
    freeze_no_news_feature: "新聞功能仍在凍結，不在前端假裝可用",
  };
  return labels[reason] ?? reason;
}

async function loadIdeas(): Promise<IdeaView | null> {
  try {
    return (await getStrategyIdeas({
      decisionMode: "paper",
      includeBlocked: true,
      limit: 20,
      sort: "score",
    })).data;
  } catch {
    return null;
  }
}

async function loadSourceHealth(): Promise<SourceHealth> {
  try {
    return { finmind: (await getFinMindStatus()).data, error: null };
  } catch (error) {
    return { finmind: null, error: friendlyDataError(error, "FinMind 診斷 API 暫時無法讀取") };
  }
}

async function loadMarketIntel(): Promise<IntelState> {
  const source = "TWSE OpenAPI 重大訊息";
  const updatedAt = new Date().toISOString();

  let companies: CompanyRow[];
  try {
    companies = (await getCompanies()).data ?? [];
  } catch (error) {
    return {
      state: "BLOCKED",
      items: [],
      selected: [],
      updatedAt,
      source,
      reason: friendlyDataError(error, "公司清單 API 暫時無法讀取"),
      failures: 0,
    };
  }

  if (companies.length === 0) {
    return {
      state: "EMPTY",
      items: [],
      selected: [],
      updatedAt,
      source,
      reason: "公司清單目前 0 筆，所以重大訊息沒有可查詢的股票。",
      failures: 0,
    };
  }

  const byId = new Map(companies.map((company) => [company.id, company]));
  const ideas = await loadIdeas();
  const ideaItems = Array.isArray(ideas?.items) ? ideas.items : [];
  const ideaCompanies = ideaItems
    .map((idea) => byId.get(idea.companyId))
    .filter((company): company is CompanyRow => Boolean(company));

  const selected = [...ideaCompanies, ...companies]
    .filter((company, index, all) => all.findIndex((item) => item.id === company.id) === index)
    .slice(0, MAX_QUERY_COMPANIES);

  const settled = await Promise.allSettled(
    selected.map(async (company) => {
      const response = await getCompanyAnnouncements(company.id, { days: ANNOUNCEMENT_DAYS });
      return (response.data ?? []).map((item) => ({
        ...item,
        companyId: company.id,
        ticker: company.ticker,
        companyName: company.name,
      }));
    })
  );

  const failures = settled.filter((result) => result.status === "rejected").length;
  const partialSource = failures > 0 ? `${source}，${failures}/${settled.length} 檔查詢失敗` : source;
  const rows = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((left, right) => right.date.localeCompare(left.date) || left.ticker.localeCompare(right.ticker))
    .slice(0, MAX_FEED_ROWS);

  if (rows.length > 0) {
    return {
      state: "LIVE",
      items: rows,
      selected,
      updatedAt: latestIso(rows.map((item) => item.date)) ?? updatedAt,
      source: partialSource,
      failures,
    };
  }

  if (failures === settled.length) {
    return {
      state: "BLOCKED",
      items: [],
      selected,
      updatedAt,
      source,
      reason: "所有重大訊息查詢都失敗，請檢查 TWSE OpenAPI 或後端路由。",
      failures,
    };
  }

  return {
    state: "EMPTY",
    items: [],
    selected,
    updatedAt,
    source: partialSource,
    reason: failures > 0
      ? `成功查詢的公司近 ${ANNOUNCEMENT_DAYS} 天沒有重大訊息；部分公司查詢失敗。`
      : `選定公司近 ${ANNOUNCEMENT_DAYS} 天沒有重大訊息。`,
    failures,
  };
}

function datasetSummary(datasets: FinMindDatasetStatus[]) {
  const live = datasets.filter((item) => item.state === "LIVE" || item.state === "READY").length;
  const blocked = datasets.filter((item) => item.state === "BLOCKED" || item.state === "ERROR" || item.state === "MOCK").length;
  const stale = datasets.filter((item) => item.state === "STALE" || item.state === "DEGRADED" || item.state === "EMPTY").length;
  return { live, blocked, stale };
}

export default async function MarketIntelPage() {
  const [result, sourceHealth] = await Promise.all([loadMarketIntel(), loadSourceHealth()]);
  const freshness = result.state === "LIVE" ? sourceFreshnessLabel(result.updatedAt) : null;
  const statsAvailable = result.state !== "BLOCKED";
  const sourceTickers = result.selected.map((company) => company.ticker).join(" / ") || "--";
  const uniqueCompanies = new Set(result.items.map((item) => item.ticker)).size;
  const featured = result.items[0] ?? null;
  const feedItems = result.items.slice(featured ? 1 : 0);
  const finmind = sourceHealth.finmind;
  const datasets = finmind?.datasets ?? [];
  const summary = datasetSummary(datasets);
  const stockNews = datasets.find((item) => item.key === "TaiwanStockNews");

  return (
    <PageFrame
      code="10"
      title="重大訊息"
      sub="台股公告與市場情報"
      note={`重大訊息 / ${stateLabel(result.state)} / ${result.state === "LIVE" ? `${result.items.length} 筆` : "尚無可發布項目"} / 來源：${result.source}`}
    >
      <MetricStrip
        columns={5}
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "訊息", value: statsAvailable ? result.items.length : "--", tone: result.items.length > 0 ? "status-ok" : "muted" },
          { label: "股票", value: statsAvailable ? uniqueCompanies || result.selected.length : "--" },
          { label: "查詢失敗", value: result.failures, tone: result.failures > 0 ? "status-bad" : "muted" },
          { label: "更新", value: formatSourceTimestamp(result.updatedAt), tone: freshness?.tone },
        ]}
      />

      <section className="intel-command-deck">
        <div className="intel-command-copy">
          <div className="tg gold">市場情報 / 官方公告</div>
          <h2>先把可驗證消息排進工作流，不把空資料包裝成新聞。</h2>
          <p>
            這一頁目前只顯示官方來源：TWSE OpenAPI 重大訊息與 FinMind 資料源狀態。
            若沒有資料，會明確標成無資料或暫停；不會抓未核准 RSS、不會把 AI 摘要偽裝成正式新聞，
            也不產生買賣建議。
          </p>
          <div className="intel-chip-rail" aria-label="目前查詢股票池">
            {result.selected.slice(0, MAX_QUERY_COMPANIES).map((company) => (
              <Link href={`/companies/${company.ticker}`} key={company.id} className="intel-chip">
                <span>{company.ticker}</span>
                <small>{company.name}</small>
              </Link>
            ))}
          </div>
        </div>
        <aside className="intel-source-card">
          <span className={`badge ${result.state === "LIVE" ? "badge-green" : result.state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>
            {stateLabel(result.state)}
          </span>
          <div>
            <span className="tg soft">公告來源</span>
            <strong>{result.source}</strong>
          </div>
          <div>
            <span className="tg soft">查詢覆蓋</span>
            <strong>{sourceCoverageLabel(result)}</strong>
          </div>
          <div>
            <span className="tg soft">查詢股票</span>
            <strong>{sourceTickers}</strong>
          </div>
          <p>
            {result.state === "LIVE"
              ? result.failures > 0
                ? `目前有 ${result.failures} 檔查詢失敗；頁面只列成功回傳的官方資料。`
                : "官方重大訊息路徑可讀；下方每一筆都可回到公司頁繼續驗證。"
              : result.reason}
          </p>
        </aside>
      </section>

      <section className="intel-feed-surface">
        <div className="intel-feed-head">
          <div>
            <div className="tg gold">
              官方訊息 / {formatSourceTimestamp(result.updatedAt)}
              {freshness && <span className={`tg ${freshness.tone}`}> / {freshness.label}</span>}
            </div>
            <h2>重大訊息工作佇列</h2>
          </div>
          <span className={`tg ${stateTone(result.state)}`}>{sourceCoverageLabel(result)}</span>
        </div>
        {result.state === "LIVE" ? (
          <div className="intel-feed-list">
            {featured && (
              <Link href={`/companies/${featured.ticker}`} className="intel-feature-card">
                <span className={`badge ${categoryTone(featured.category)}`}>{categoryLabel(featured.category)}</span>
                <strong>{intelTitleText(featured)}</strong>
                <span className="tc soft">{featured.ticker} / {featured.companyName} / {formatDate(featured.date)}</span>
              </Link>
            )}
            {feedItems.map((item) => (
              <Link href={`/companies/${item.ticker}`} className="intel-feed-row" key={`${item.ticker}-${item.id}`}>
                <span className="tg soft">{formatDate(item.date)}</span>
                <span className="tg gold">{item.ticker}</span>
                <span className="intel-feed-title">
                  {intelTitleText(item)}
                  <small>{item.companyName}</small>
                </span>
                <span className={`badge ${categoryTone(item.category)}`}>{categoryLabel(item.category)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="intel-empty-state">
            <strong>{stateLabel(result.state)}</strong>
            <p>{result.reason}</p>
            <span className="tg soft">查詢股票：{sourceTickers}</span>
          </div>
        )}
      </section>

      <section className="intel-feed-surface">
        <div className="intel-feed-head">
          <div>
            <div className="tg gold">FinMind / 資料集狀態</div>
            <h2>新聞與市場資料接入狀態</h2>
          </div>
          <span className={`tg ${finmind?.state === "LIVE_READY" ? "status-ok" : finmind ? "gold" : "status-bad"}`}>
            {finmind ? `已接 ${summary.live} / 待處理 ${summary.stale} / 阻擋 ${summary.blocked}` : "診斷暫停"}
          </span>
        </div>
        <div className="intel-empty-state">
          <strong>{stockNews ? `台股新聞：${datasetStateLabel(stockNews.state)}` : "台股新聞：尚未接入前端列表"}</strong>
          <p>
            {stockNews
              ? `列數 ${stockNews.rowCount ?? 0}，最新日期 ${stockNews.latestDate ?? "--"}，狀態原因：${missingReasonText(stockNews.missingReason ?? stockNews.degradedReason)}。`
              : sourceHealth.error ?? "目前仍以重大訊息與已審核每日簡報為正式顯示來源。"}
          </p>
          <span className="tg soft">
            FinMind token 只顯示是否存在；不顯示 token 值。新聞資料若為 EMPTY/BLOCKED，不會被包裝成正式新聞。
          </span>
        </div>
      </section>
    </PageFrame>
  );
}
