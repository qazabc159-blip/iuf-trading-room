import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getCompanies,
  getCompanyAnnouncements,
  getStrategyIdeas,
  type CompanyAnnouncement,
} from "@/lib/api";

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
  const source = "GET /api/v1/companies/:id/announcements?days=30";
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
      reason: error instanceof Error ? error.message : "company list request failed",
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
      reason: "Company list returned zero rows, so Market Intel has no tickers to query.",
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
  const partialSource = failures > 0 ? `${source} (${failures}/${settled.length} calls failed)` : source;
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
      reason: "All TWSE announcement endpoint calls failed.",
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
      ? "Successful announcement requests returned zero rows; coverage is partial because some company calls failed."
      : "TWSE returned zero material announcements for the selected companies in the last 30 days.",
    failures,
  };
}

export default async function MarketIntelPage() {
  const result = await loadMarketIntel();
  const statsAvailable = result.state !== "BLOCKED";
  const sourceTickers = result.selected.map((company) => company.ticker).join(" / ") || "--";
  const uniqueCompanies = new Set(result.items.map((item) => item.ticker)).size;

  return (
    <PageFrame
      code="10"
      title="Market Intel"
      sub="TWSE material announcements"
      note={`[10] MARKET INTEL / ${result.state} / ${result.state === "LIVE" ? `${result.items.length} news rows` : "no rendered news rows"} / source ${result.source}`}
    >
      <MetricStrip
        columns={5}
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "NEWS", value: statsAvailable ? result.items.length : "--", tone: result.items.length > 0 ? "up" : "muted" },
          { label: "COMPANIES", value: statsAvailable ? uniqueCompanies || result.selected.length : "--" },
          { label: "FAILURES", value: result.state === "BLOCKED" && result.failures === 0 ? "--" : result.failures, tone: result.failures > 0 ? "gold" : "muted" },
          { label: "UPDATED", value: formatTime(result.updatedAt) },
        ]}
      />

      <Panel code="INT-SRC" title={`${formatTime(result.updatedAt)} TPE`} sub="source + selection" right={result.source}>
        <div className="source-line">
          <span className={`badge ${result.state === "LIVE" ? "badge-green" : result.state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>
            {result.state}
          </span>
          <span className="tg soft">Source: {result.source}</span>
          <span className="tg soft">Updated {formatTime(result.updatedAt)}</span>
          <span className="tg soft">Universe: {sourceTickers}</span>
        </div>
        {result.failures > 0 && result.state === "LIVE" && (
          <div className="terminal-note">
            PARTIAL: {result.failures} selected company announcement request{result.failures === 1 ? "" : "s"} failed, so this LIVE feed is not full-universe coverage.
          </div>
        )}
        {result.state !== "LIVE" && (
          <div className="terminal-note">
            {result.state}: {result.reason}
          </div>
        )}
      </Panel>

      <Panel code="INT-FEED" title="Important News Feed" sub="company-linked announcements / read only" right={result.state === "LIVE" ? `${result.items.length} ROWS` : result.state}>
        {result.state === "LIVE" ? (
          <div className="market-intel-list">
            <div className="row table-head telex-row">
              <span>Date</span>
              <span>Ticker</span>
              <span>Title</span>
              <span>Category</span>
            </div>
            {result.items.map((item) => (
              <Link href={`/companies/${item.ticker}`} className="row telex-row" key={`${item.ticker}-${item.id}`}>
                <span className="tg soft">{formatDate(item.date)}</span>
                <span className="tg gold">{item.ticker}</span>
                <span className="market-intel-title">
                  {item.title || "Untitled announcement"}
                  <small style={{ display: "block", marginTop: 3, color: "var(--night-soft)" }}>{item.companyName}</small>
                </span>
                <span className={`badge ${categoryTone(item.category)}`}>{item.category || "TWSE"}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="terminal-note">
            {result.state}: no news rows are rendered without a real TWSE response.
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}
