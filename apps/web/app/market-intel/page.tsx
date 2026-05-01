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

type MarketIntelItem = {
  id: string;
  kind: "announcement" | "rss";
  title: string;
  category: string;
  source: string;
  publishedAt: string;
  href: string | null;
  ticker: string | null;
  companyName: string | null;
  summary: string | null;
  score: number;
};

type IntelState =
  | {
      state: "LIVE";
      items: MarketIntelItem[];
      announcements: MarketIntelItem[];
      rss: MarketIntelItem[];
      selected: CompanyRow[];
      updatedAt: string;
      source: string;
      failures: string[];
    }
  | {
      state: "EMPTY";
      items: MarketIntelItem[];
      announcements: MarketIntelItem[];
      rss: MarketIntelItem[];
      selected: CompanyRow[];
      updatedAt: string;
      source: string;
      reason: string;
      failures: string[];
    }
  | {
      state: "BLOCKED";
      items: MarketIntelItem[];
      announcements: MarketIntelItem[];
      rss: MarketIntelItem[];
      selected: CompanyRow[];
      updatedAt: string;
      source: string;
      reason: string;
      failures: string[];
    };

const YAHOO_RSS_FEEDS = [
  { label: "Yahoo 台股動態", url: "https://tw.stock.yahoo.com/rss?category=tw-market" },
  { label: "Yahoo 最新新聞", url: "https://tw.stock.yahoo.com/rss?category=news" },
  { label: "Yahoo 研究報導", url: "https://tw.stock.yahoo.com/rss?category=research" },
];

const IMPORTANT_KEYWORDS = [
  "台股",
  "台積電",
  "半導體",
  "AI",
  "伺服器",
  "CoWoS",
  "法說",
  "營收",
  "財報",
  "EPS",
  "庫藏股",
  "併購",
  "增資",
  "減資",
  "停牌",
  "暫停交易",
  "注意股",
  "處置",
  "外資",
  "美元",
  "匯率",
  "關稅",
  "Fed",
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function stateLabel(state: IntelState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function stateTone(state: IntelState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlField(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function scoreIntel(title: string, category: string, ticker: string | null) {
  const haystack = `${title} ${category}`.toLowerCase();
  let score = ticker ? 12 : 0;
  for (const keyword of IMPORTANT_KEYWORDS) {
    if (haystack.includes(keyword.toLowerCase())) score += 8;
  }
  if (/重大|公告|法說|營收|財報|併購|增資|減資|庫藏股/.test(title)) score += 10;
  if (/台積電|2330|鴻海|2317|聯發科|2454|廣達|2382/.test(title)) score += 8;
  return score;
}

async function loadIdeas(): Promise<IdeaView | null> {
  try {
    return (await getStrategyIdeas({
      decisionMode: "paper",
      includeBlocked: true,
      limit: 24,
      sort: "score",
    })).data;
  } catch {
    return null;
  }
}

async function fetchYahooFeed(feed: { label: string; url: string }): Promise<MarketIntelItem[]> {
  const response = await fetch(feed.url, {
    cache: "no-store",
    headers: {
      "user-agent": "IUF-Trading-Room/1.0 market-intel reader",
      accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!response.ok) {
    throw new Error(`${feed.label} RSS ${response.status}`);
  }

  const xml = await response.text();
  const blocks = Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map((match) => match[1]);
  return blocks.slice(0, 18).map((block, index) => {
    const title = xmlField(block, "title");
    const category = xmlField(block, "category") || feed.label;
    const link = xmlField(block, "link") || null;
    const pubDate = xmlField(block, "pubDate");
    const description = xmlField(block, "description");
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    return {
      id: `${feed.label}-${index}-${title}`,
      kind: "rss",
      title: title || "未命名新聞",
      category,
      source: feed.label,
      publishedAt,
      href: link,
      ticker: null,
      companyName: null,
      summary: description || null,
      score: scoreIntel(title, category, null),
    };
  });
}

function announcementToIntel(item: CompanyAnnouncement, company: CompanyRow): MarketIntelItem {
  const title = item.title || "未命名重大訊息";
  return {
    id: `ann-${company.ticker}-${item.id}`,
    kind: "announcement",
    title,
    category: item.category || "重大訊息",
    source: "公司公告 API",
    publishedAt: item.date,
    href: `/companies/${company.ticker}`,
    ticker: company.ticker,
    companyName: company.name,
    summary: item.body ?? null,
    score: scoreIntel(title, item.category || "重大訊息", company.ticker),
  };
}

async function loadCompanyAnnouncements(selected: CompanyRow[]) {
  const settled = await Promise.allSettled(
    selected.map(async (company) => {
      const response = await getCompanyAnnouncements(company.id, { days: 14 });
      return (response.data ?? []).map((item) => announcementToIntel(item, company));
    })
  );

  const failures = settled
    .map((result, index) => result.status === "rejected" ? `${selected[index]?.ticker ?? "?"}: ${String(result.reason)}` : null)
    .filter((item): item is string => Boolean(item));

  const rows = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 40);

  return { rows, failures };
}

async function selectCompanies(companies: CompanyRow[]) {
  const byId = new Map(companies.map((company) => [company.id, company]));
  const ideas = await loadIdeas();
  const ideaCompanies = ideas?.items
    .map((idea) => byId.get(idea.companyId))
    .filter((company): company is CompanyRow => Boolean(company)) ?? [];

  const blueChips = ["2330", "2317", "2454", "2382", "2308", "2412", "2881", "2882"]
    .map((ticker) => companies.find((company) => company.ticker === ticker))
    .filter((company): company is CompanyRow => Boolean(company));

  return [...ideaCompanies, ...blueChips, ...companies]
    .filter((company, index, all) => all.findIndex((item) => item.id === company.id) === index)
    .slice(0, 18);
}

async function loadMarketIntel(): Promise<IntelState> {
  const updatedAt = new Date().toISOString();
  const source = "公司公告 API + Yahoo 股市 RSS";

  let companies: CompanyRow[] = [];
  const failures: string[] = [];
  try {
    companies = (await getCompanies()).data ?? [];
  } catch (error) {
    failures.push(`公司主檔：${error instanceof Error ? error.message : String(error)}`);
  }

  const selected = companies.length > 0 ? await selectCompanies(companies) : [];
  const [announcementResult, rssResults] = await Promise.all([
    selected.length > 0 ? loadCompanyAnnouncements(selected) : Promise.resolve({ rows: [], failures: [] }),
    Promise.allSettled(YAHOO_RSS_FEEDS.map(fetchYahooFeed)),
  ]);

  failures.push(...announcementResult.failures);
  const rssFailures = rssResults
    .map((result, index) => result.status === "rejected" ? `${YAHOO_RSS_FEEDS[index].label}：${String(result.reason)}` : null)
    .filter((item): item is string => Boolean(item));
  failures.push(...rssFailures);

  const rss = rssResults
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 48);

  const announcements = announcementResult.rows;
  const items = [...announcements, ...rss]
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return right.publishedAt.localeCompare(left.publishedAt);
    })
    .slice(0, 24);

  if (items.length > 0) {
    return { state: "LIVE", items, announcements, rss, selected, updatedAt, source, failures };
  }

  if (failures.length > 0) {
    return {
      state: "BLOCKED",
      items,
      announcements,
      rss,
      selected,
      updatedAt,
      source,
      reason: failures.slice(0, 3).join("；"),
      failures,
    };
  }

  return {
    state: "EMPTY",
    items,
    announcements,
    rss,
    selected,
    updatedAt,
    source,
    reason: "公司公告與 Yahoo 股市 RSS 目前都沒有回傳資料。",
    failures,
  };
}

function IntelLink({ item }: { item: MarketIntelItem }) {
  const content = (
    <>
      <span className="tg soft">{formatDateTime(item.publishedAt)}</span>
      <span className="tg gold">{item.ticker ?? item.source}</span>
      <span className="market-intel-title">
        {item.title}
        <small style={{ display: "block", marginTop: 3, color: "var(--night-soft)" }}>
          {item.companyName ? `${item.companyName} / ${item.source}` : item.source}
        </small>
      </span>
      <span className="badge">{item.category || (item.kind === "announcement" ? "重大訊息" : "新聞")}</span>
    </>
  );

  if (item.href?.startsWith("/")) {
    return <Link href={item.href} className="row telex-row">{content}</Link>;
  }
  if (item.href) {
    return <a href={item.href} target="_blank" rel="noreferrer" className="row telex-row">{content}</a>;
  }
  return <div className="row telex-row">{content}</div>;
}

export default async function MarketIntelPage() {
  const result = await loadMarketIntel();
  const selectedTickers = result.selected.map((company) => company.ticker).join(" / ") || "尚未取得公司池";
  const topItems = result.items.slice(0, 10);

  return (
    <PageFrame
      code="10"
      title="重大訊息"
      sub="公告新聞"
      note={`重大訊息 / ${stateLabel(result.state)} / 來源：${result.source}`}
    >
      <MetricStrip
        columns={5}
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "重點", value: topItems.length, tone: topItems.length > 0 ? "up" : "muted" },
          { label: "公司公告", value: result.announcements.length },
          { label: "新聞", value: result.rss.length },
          { label: "更新", value: formatDateTime(result.updatedAt) },
        ]}
      />

      <Panel code="INT-FOCUS" title={`${formatDateTime(result.updatedAt)} 台北`} sub="今日重點 / 規則篩選 v1" right={stateLabel(result.state)}>
        <div className="source-line">
          <span className={`badge ${result.state === "LIVE" ? "badge-green" : result.state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>
            {stateLabel(result.state)}
          </span>
          <span className="tg soft">來源：{result.source}</span>
          <span className="tg soft">追蹤：{selectedTickers}</span>
        </div>
        {result.failures.length > 0 && (
          <div className="terminal-note">
            部分來源暫停：{result.failures.slice(0, 2).join("；")}
          </div>
        )}
        {result.state !== "LIVE" && (
          <div className="terminal-note">{stateLabel(result.state)}：{result.reason}</div>
        )}
        {result.state === "LIVE" && (
          <div className="market-intel-list">
            <div className="row table-head telex-row">
              <span>時間</span>
              <span>來源</span>
              <span>標題</span>
              <span>分類</span>
            </div>
            {topItems.map((item) => <IntelLink key={item.id} item={item} />)}
          </div>
        )}
      </Panel>

      <div className="intel-two-col">
        <Panel code="INT-MOPS" title="公司重大訊息" sub="正式公告 / 公司 API" right={`${result.announcements.length} 筆`}>
          {result.announcements.length === 0 ? (
            <div className="terminal-note">無資料：追蹤公司近 14 天沒有回傳重大訊息。</div>
          ) : (
            <div className="market-intel-list">
              {result.announcements.slice(0, 8).map((item) => <IntelLink key={item.id} item={item} />)}
            </div>
          )}
        </Panel>

        <Panel code="INT-RSS" title="財經新聞" sub="Yahoo 股市 RSS / 台股動態" right={`${result.rss.length} 筆`}>
          {result.rss.length === 0 ? (
            <div className="terminal-note">無資料：Yahoo RSS 目前沒有回傳可用新聞，或來源暫時阻擋。</div>
          ) : (
            <div className="market-intel-list">
              {result.rss.slice(0, 8).map((item) => <IntelLink key={item.id} item={item} />)}
            </div>
          )}
        </Panel>
      </div>
    </PageFrame>
  );
}
