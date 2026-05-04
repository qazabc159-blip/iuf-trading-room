import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getCompanies,
  getCompanyAnnouncements,
  getStrategyIdeas,
  type CompanyAnnouncement,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

export const dynamic = "force-dynamic";

type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type IdeaView = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];

type IntelItem = CompanyAnnouncement & {
  companyId: string;
  ticker: string;
  companyName: string;
};

type IntelState =
  | { state: "LIVE"; items: IntelItem[]; selected: CompanyRow[]; updatedAt: string; source: string; failures: number }
  | { state: "EMPTY"; items: IntelItem[]; selected: CompanyRow[]; updatedAt: string; source: string; reason: string; failures: number }
  | { state: "BLOCKED"; items: IntelItem[]; selected: CompanyRow[]; updatedAt: string; source: string; reason: string; failures: number };

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

function formatStamp(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatShortStamp(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function stateTone(state: IntelState["state"]) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function categoryTone(category: string) {
  if (/dividend|cash dividend|stock dividend|股利|配息|配股/i.test(category)) return "badge-yellow";
  if (/financial|revenue|eps|earnings|財報|營收|損益/i.test(category)) return "badge-green";
  if (/material|announcement|重大|公告|訊息/i.test(category)) return "badge-blue";
  return "badge";
}

function categoryLabel(category: string | null | undefined) {
  if (!category) return "公告";
  const key = category.toLowerCase();
  if (key === "earnings") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "theme") return "主題";
  if (key === "industry") return "產業";
  if (key === "supply_chain") return "供應鏈";
  if (key === "technical") return "技術";
  if (key === "fundamental") return "基本面";
  if (key === "material" || key === "announcement") return "公告";
  return category.replace(/[_-]/g, " ");
}

function sourceCoverageLabel(result: IntelState) {
  if (result.state === "BLOCKED") return "來源暫停";
  if (result.items.length === 0) return "近 30 天無公告";
  return `${result.items.length} 筆 / ${new Set(result.items.map((item) => item.ticker)).size} 檔`;
}

function hasBrokenText(value: string | null | undefined) {
  if (!value) return false;
  return /[\uFFFD]|Ã|Â|undefined|null/i.test(value);
}

function intelTitleText(item: IntelItem) {
  const raw = item.title || "未命名公告";
  if (hasBrokenText(raw)) return "消息文字待整理；保留來源紀錄，不作交易解讀。";
  if (/^[\x00-\x7F\s%.,:;()/-]+$/.test(raw) && /[A-Za-z]/.test(raw)) {
    return "外文消息待整理；保留來源紀錄，不納入正式判讀。";
  }
  return raw;
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

async function loadMarketIntel(): Promise<IntelState> {
  const source = "臺股重大訊息";
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
      reason: friendlyDataError(error, "公司清單讀取失敗。"),
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
    .filter((company): company is CompanyRow => Boolean(company)) ?? [];

  const selected = [...ideaCompanies, ...companies]
    .filter((company, index, all) => all.findIndex((item) => item.id === company.id) === index)
    .slice(0, 16);

  const settled = await Promise.allSettled(
    selected.map(async (company) => {
      const response = await getCompanyAnnouncements(company.id, { days: 30 });
      return (response.data ?? []).map((item) => ({
        ...item,
        companyId: company.id,
        ticker: company.ticker,
        companyName: company.name,
      }));
    })
  );

  const failures = settled.filter((result) => result.status === "rejected").length;
  const partialSource = failures > 0 ? `${source}（${failures}/${settled.length} 檔查詢失敗）` : source;
  const rows = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((left, right) => right.date.localeCompare(left.date) || left.ticker.localeCompare(right.ticker))
    .slice(0, 60);

  if (rows.length > 0) {
    return { state: "LIVE", items: rows, selected, updatedAt, source: partialSource, failures };
  }

  if (failures === settled.length) {
    return {
      state: "BLOCKED",
      items: [],
      selected,
      updatedAt,
      source,
      reason: "所有重大訊息查詢都失敗。",
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
      ? "成功查詢的公司近 30 天沒有重大訊息；部分公司查詢失敗。"
      : "選定公司近 30 天沒有重大訊息。",
    failures,
  };
}

function stateLabel(state: IntelState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

export default async function MarketIntelPage() {
  const result = await loadMarketIntel();
  const statsAvailable = result.state !== "BLOCKED";
  const sourceTickers = result.selected.map((company) => company.ticker).join(" / ") || "--";
  const uniqueCompanies = new Set(result.items.map((item) => item.ticker)).size;
  const featured = result.items[0] ?? null;
  const feedItems = result.items.slice(featured ? 1 : 0);

  return (
    <PageFrame
      code="10"
      title="重大訊息"
      sub="臺股公告與重點消息"
      note={`重大訊息 / ${stateLabel(result.state)} / ${result.state === "LIVE" ? `${result.items.length} 筆消息` : "沒有渲染假消息"} / 來源：${result.source}`}
    >
      <MetricStrip
        columns={5}
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "消息", value: statsAvailable ? result.items.length : "--", tone: result.items.length > 0 ? "status-ok" : "muted" },
          { label: "公司", value: statsAvailable ? uniqueCompanies || result.selected.length : "--" },
          { label: "失敗", value: result.state === "BLOCKED" && result.failures === 0 ? "--" : result.failures, tone: result.failures > 0 ? "status-bad" : "muted" },
          { label: "更新", value: formatShortStamp(result.updatedAt) },
        ]}
      />

      <section className="intel-command-deck">
        <div className="intel-command-copy">
          <div className="tg gold">官方來源 / 重大訊息</div>
          <h2>臺股公告監控，不渲染假新聞</h2>
          <p>
            本頁目前只讀公司連結的 TWSE OpenAPI 重大訊息，並以策略候選與公司池挑選追蹤股票。
            若官方來源回傳 0 筆，就顯示無資料；不會用 RSS、商用新聞或 AI 文字假裝有消息。
          </p>
          <div className="intel-chip-rail" aria-label="本次追蹤股票">
            {result.selected.slice(0, 16).map((company) => (
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
            <span className="tg soft">來源</span>
            <strong>{result.source}</strong>
          </div>
          <div>
            <span className="tg soft">覆蓋</span>
            <strong>{sourceCoverageLabel(result)}</strong>
          </div>
          <div>
            <span className="tg soft">更新</span>
            <strong>{formatStamp(result.updatedAt)}</strong>
          </div>
          <p>
            {result.state === "LIVE"
              ? result.failures > 0
                ? `部分覆蓋：${result.failures} 檔查詢失敗，這份消息流不是完整 universe。`
                : "官方來源可讀；本頁只做公告整理，不作自動交易判斷。"
              : result.reason}
          </p>
        </aside>
      </section>

      <section className="intel-feed-surface">
        <div className="intel-feed-head">
          <div>
            <div className="tg gold">消息流 / {formatStamp(result.updatedAt)}</div>
            <h2>官方重大訊息</h2>
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
            <span className="tg soft">追蹤：{sourceTickers}</span>
          </div>
        )}
      </section>
    </PageFrame>
  );
}
