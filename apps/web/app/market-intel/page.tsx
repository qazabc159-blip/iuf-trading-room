import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
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
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function stateTone(state: IntelState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
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

function hasBrokenText(value: string | null | undefined) {
  if (!value) return false;
  return /�|Ã|Â|undefined|null/i.test(value);
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
  const ideaCompanies = ideas?.items
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
          { label: "消息", value: statsAvailable ? result.items.length : "--", tone: result.items.length > 0 ? "up" : "muted" },
          { label: "公司", value: statsAvailable ? uniqueCompanies || result.selected.length : "--" },
          { label: "失敗", value: result.state === "BLOCKED" && result.failures === 0 ? "--" : result.failures, tone: result.failures > 0 ? "gold" : "muted" },
          { label: "更新", value: formatTime(result.updatedAt) },
        ]}
      />

      <Panel code="INT-SRC" title="來源與選股範圍" sub="正式公告查詢" right={result.source}>
        <div className="source-line">
          <span className={`badge ${result.state === "LIVE" ? "badge-green" : result.state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>
            {stateLabel(result.state)}
          </span>
          <span className="tg soft">來源：{result.source}</span>
          <span className="tg soft">更新 {formatTime(result.updatedAt)}</span>
          <span className="tg soft">追蹤：{sourceTickers}</span>
        </div>
        {result.failures > 0 && result.state === "LIVE" && (
          <div className="terminal-note">
            部分覆蓋：{result.failures} 檔公司重大訊息查詢失敗，所以這份消息流不是完整 universe。
          </div>
        )}
        {result.state !== "LIVE" && (
          <div className="terminal-note">
            {stateLabel(result.state)}：{result.reason}
          </div>
        )}
      </Panel>

      <Panel code="INT-FEED" title="重點消息流" sub="公司連結公告 / 只讀" right={result.state === "LIVE" ? `${result.items.length} 筆` : stateLabel(result.state)}>
        {result.state === "LIVE" ? (
          <div className="market-intel-list">
            <div className="row table-head telex-row">
              <span>日期</span>
              <span>代號</span>
              <span>標題</span>
              <span>分類</span>
            </div>
            {result.items.map((item) => (
              <Link href={`/companies/${item.ticker}`} className="row telex-row" key={`${item.ticker}-${item.id}`}>
                <span className="tg soft">{formatDate(item.date)}</span>
                <span className="tg gold">{item.ticker}</span>
                <span className="market-intel-title">
                  {intelTitleText(item)}
                  <small style={{ display: "block", marginTop: 3, color: "var(--night-soft)" }}>{item.companyName}</small>
                </span>
                <span className={`badge ${categoryTone(item.category)}`}>{categoryLabel(item.category)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="terminal-note">
            {stateLabel(result.state)}：沒有真實重大訊息回應時，不渲染假消息。
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}
