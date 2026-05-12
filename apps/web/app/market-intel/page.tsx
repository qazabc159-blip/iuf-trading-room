import Link from "next/link";

import {
  getFinMindStatus,
  getMarketIntelAnnouncements,
  getNewsTop10,
  type CompanyAnnouncement,
  type FinMindDatasetStatus,
  type FinMindSourceStatus,
  type NewsAiItem,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

import styles from "./market-intel-v03.module.css";

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
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTime(value: string | null | undefined) {
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

function stateLabel(state: IntelState["state"]) {
  if (state === "LIVE") return "可用";
  if (state === "EMPTY") return "無新訊";
  return "需處理";
}

function stateTone(state: IntelState["state"]) {
  if (state === "LIVE") return styles.ok;
  if (state === "EMPTY") return styles.warn;
  return styles.bad;
}

function datasetTone(state: FinMindDatasetStatus["state"]) {
  if (state === "LIVE" || state === "READY") return styles.ok;
  if (state === "STALE" || state === "EMPTY" || state === "DEGRADED" || state === "FALLBACK" || state === "CLOSED") {
    return styles.warn;
  }
  return styles.bad;
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
    MOCK: "待確認",
    CLOSED: "休市",
  };
  return labels[state] ?? state;
}

function categoryLabel(category: string | null | undefined) {
  if (!category) return "市場情報";
  const key = category.toLowerCase();
  if (key.includes("material") || key.includes("announcement") || category.includes("重大")) return "重大訊息";
  if (key.includes("market") || key.includes("macro") || key.includes("index")) return "大盤";
  if (key.includes("news")) return "台股新聞";
  return category.replace(/[_-]/g, " ");
}

function userFacingReason(reason: string | null | undefined) {
  if (!reason) return "目前沒有可顯示的市場級消息。";
  if (/unauth|auth|session|login|cookie|401/i.test(reason)) return "登入狀態需要更新，重新登入後即可讀取市場情報。";
  if (/fetch failed|network|ECONNREFUSED|API_BASE|base url/i.test(reason)) return "市場情報連線失敗，請稍後重新整理。";
  return reason.replace(/token|secret|session|cookie|authorization|bearer|api[-_]?key|env|database|redis|timeout_[a-z0-9_]+/gi, "資料來源");
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

function newsAiItemToIntelItem(item: NewsAiItem, index: number): IntelItem {
  const sourceLabel =
    item.source === "twse_announcements"
      ? "重大訊息"
      : item.source === "finmind_stock_news"
        ? "台股新聞"
        : "市場情報";

  return {
    id: item.id ?? `ai-${index}`,
    date: item.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    title: item.headline ?? "",
    category: item.impact_tier ? `${sourceLabel} (${item.impact_tier})` : sourceLabel,
    body: item.why_matters ?? undefined,
    ticker: item.ticker ?? "MARKET",
    companyName: item.companyName ?? (item.ticker && item.ticker !== "MARKET" ? item.ticker : "大盤"),
    url: item.url ?? undefined,
    source: item.source,
  };
}

async function loadMarketIntel(): Promise<IntelState> {
  const updatedAt = new Date().toISOString();

  try {
    const top10 = (await getNewsTop10()).data;
    if (top10.items.length >= 1 && !top10.stale_reason) {
      const items = top10.items.map(newsAiItemToIntelItem);
      const selected = [
        ...new Map(
          items
            .filter((item) => item.ticker && item.ticker !== "MARKET")
            .map((item) => [
              item.ticker,
              { id: item.ticker, ticker: item.ticker, name: item.companyName ?? item.ticker },
            ])
        ).values(),
      ].slice(0, MAX_QUERY_COMPANIES);
      const source =
        top10.selection_mode === "ai"
          ? "OpenAI 每日市場篩選"
          : marketIntelSourceLabel(top10.items[0]?.source ?? "mixed");
      return {
        state: "LIVE",
        items,
        selected,
        updatedAt: top10.as_of ?? updatedAt,
        source,
        failures: 0,
      };
    }
  } catch {
    // Fall through to official announcement aggregate.
  }

  try {
    const aggregate = await getMarketIntelAnnouncements({
      days: ANNOUNCEMENT_DAYS,
      limit: MAX_FEED_ROWS,
      scope: "market",
    });
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
        updatedAt,
        source: marketIntelSourceLabel(aggregate.data.source),
        failures: aggregate.data.failures,
      };
    }

    return {
      state: "EMPTY",
      items,
      selected,
      updatedAt,
      source: marketIntelSourceLabel(aggregate.data.source),
      reason: `近 ${ANNOUNCEMENT_DAYS} 天沒有新的市場級情報。`,
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

function sourceCoverageLabel(result: IntelState) {
  if (result.items.length === 0) return `近 ${ANNOUNCEMENT_DAYS} 天 0 筆`;
  const companies = new Set(result.items.map((item) => item.ticker).filter((ticker) => ticker && ticker !== "MARKET")).size;
  return companies > 0 ? `${result.items.length} 筆 / ${companies} 檔` : `${result.items.length} 筆市場級`;
}

function datasetAge(dataset: FinMindDatasetStatus) {
  return dataset.latestDate ? formatDate(dataset.latestDate) : formatDateTime(dataset.lastFetchTs);
}

function readinessPct(result: IntelState, finmind: FinMindSourceStatus | null) {
  if (result.state !== "LIVE") return 0;
  const sourceScore = finmind?.state === "LIVE_READY" ? 42 : finmind ? 24 : 10;
  const newsScore = Math.min(result.items.length, 10) * 4;
  const datasetScore = Math.min(finmind?.datasets.filter((item) => item.state === "LIVE" || item.state === "READY").length ?? 0, 6) * 3;
  return Math.min(96, sourceScore + newsScore + datasetScore);
}

function timelineRows(result: IntelState, finmind: FinMindSourceStatus | null) {
  const datasets = finmind?.datasets ?? [];
  return [
    { label: "市場情報", state: result.state === "LIVE" ? "fresh" : "review", time: formatDateTime(result.updatedAt) },
    { label: "重大訊息", state: result.items.some((item) => categoryLabel(item.category) === "重大訊息") ? "fresh" : "review", time: sourceCoverageLabel(result) },
    { label: "FinMind", state: finmind?.state === "LIVE_READY" ? "fresh" : "review", time: finmind ? `${datasets.length} 組資料` : "待連線" },
    { label: "策略入口", state: result.state === "LIVE" ? "fresh" : "review", time: result.state === "LIVE" ? "可進研究" : "先補資料" },
  ] as const;
}

export default async function MarketIntelPage() {
  const [result, health] = await Promise.all([loadMarketIntel(), loadSourceHealth()]);
  const finmind = health.finmind;
  const datasets = finmind?.datasets.slice(0, 8) ?? [];
  const readiness = readinessPct(result, finmind);
  const importantItems = result.items.slice(0, 8);
  const highImpact = result.items.filter((item) => /HIGH|重大|material|announcement/i.test(item.category ?? "")).length;
  const mode = readiness >= 80 ? "ACCURATE" : readiness >= 55 ? "FAST" : "RESEARCH";

  return (
    <div className={styles.page}>
      <div className={styles.bgGrid} />
      <aside className={styles.nav}>
        <div className={styles.brandBar}>
          <i />
          <span>IUF · CMD</span>
        </div>
        <h1>情報—決策—倉位</h1>
        <p>市場情報</p>

        <div className={styles.navGroup}>情報入口</div>
        <Link className={`${styles.navLink} ${styles.active}`} href="/market-intel"><span>7a</span>市場情報</Link>

        <div className={styles.navGroup}>策略決策</div>
        <Link className={styles.navLink} href="/ideas"><span>7b</span>策略想法</Link>
        <Link className={styles.navLinkMuted} href="/runs"><span>7c</span>策略批次</Link>

        <div className={styles.navGroup}>執行</div>
        <Link className={styles.navLink} href="/portfolio"><span>7d</span>模擬交易室</Link>
        <Link className={styles.navLinkMuted} href="/alerts"><span>07</span>警示</Link>
      </aside>

      <main className={styles.content}>
        <header className={styles.header}>
          <div>
            <div className={styles.crumb}>IUF / 情報—決策—倉位 / 市場情報</div>
            <h1>研究 · 從三項判讀進入策略入口</h1>
            <p>先確認市場情報、資料新鮮度與來源健康，再決定是否進入策略想法與模擬交易室。</p>
          </div>
          <div className={styles.headerRight}>
            <span>{formatDateTime(result.updatedAt)} TPE</span>
            <b>RESEARCH MODE</b>
          </div>
        </header>

        <div className={styles.safety}>
          <i />
          <span>本頁只做市場研究與來源判讀，不顯示目標價、勝率或買賣建議。</span>
          <b>RESEARCH ONLY</b>
        </div>

        <section className={styles.hero}>
          <div>
            <div className={styles.code}>M-B3 · DECISION GATE</div>
            <h2>三模式 readiness · 現在落在 <b>{mode}</b></h2>
            <p>RESEARCH 是寬鬆研究，FAST 是一般決策，ACCURATE 是高門檻決策。模式由來源覆蓋、新鮮度與訊號量推估，不直接代表交易結論。</p>
            <div className={styles.metaline}>
              <span>市場情報 · <b>{sourceCoverageLabel(result)}</b></span>
              <span className={result.state === "LIVE" ? styles.okText : styles.warnText}>資料狀態 · <b>{stateLabel(result.state)}</b></span>
              <span>來源 · <b>{result.source}</b></span>
            </div>
          </div>

          <div className={styles.modeStack}>
            {[
              { name: "RESEARCH", need: "30%", value: Math.max(readiness, 30), current: mode === "RESEARCH" },
              { name: "FAST", need: "55%", value: Math.max(Math.min(readiness, 100), 12), current: mode === "FAST" },
              { name: "ACCURATE", need: "80%", value: Math.min(readiness, 100), current: mode === "ACCURATE" },
            ].map((item) => (
              <div className={styles.modeCard} key={item.name}>
                <div className={item.current ? styles.currentMode : ""}>{item.name}{item.current ? "  ◂ 當前" : ""}</div>
                <div className={styles.gauge}><i style={{ width: `${Math.min(item.value, 100)}%` }} /></div>
                <div className={styles.modeMeta}><span>門檻 {item.need}</span><b>{readiness}%</b></div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.kpiGrid}>
          <div className={styles.kpi}><span>市場情報</span><b>{result.items.length}</b><small>{result.source}</small></div>
          <div className={styles.kpi}><span>重大訊息</span><b>{highImpact}</b><small>近 {ANNOUNCEMENT_DAYS} 天</small></div>
          <div className={styles.kpi}><span>追蹤公司</span><b>{result.selected.length}</b><small>情報連結公司池</small></div>
          <div className={styles.kpi}><span>FinMind</span><b>{finmind?.state === "LIVE_READY" ? "正常" : "待確認"}</b><small>官方資料流</small></div>
        </section>

        {result.state !== "LIVE" && (
          <div className={styles.notice}>
            <b>{stateLabel(result.state)}</b>
            <span>{"reason" in result ? result.reason : "目前沒有可顯示的市場情報。"}</span>
          </div>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.code}>M-B5</span>
            <h2>今日重點訊號</h2>
            <em>{importantItems.length} / {result.items.length}</em>
          </div>
          <div className={styles.feed}>
            {importantItems.length > 0 ? importantItems.map((item, index) => (
              <Link
                className={styles.feedRow}
                href={item.ticker && item.ticker !== "MARKET" ? `/companies/${encodeURIComponent(item.ticker)}` : item.url ?? "#"}
                key={`${item.id}-${index}`}
              >
                <span className={styles.sym}>{item.ticker ?? "市場"}</span>
                <div>
                  <b>{item.title || "市場消息尚未提供標題"}</b>
                  <small>{categoryLabel(item.category)} · {item.companyName ?? "大盤"}{item.body ? ` · ${item.body}` : ""}</small>
                </div>
                <strong>{formatDate(item.date)}</strong>
              </Link>
            )) : (
              <div className={styles.emptyState}>目前沒有新的市場級情報，等待下一輪正式資料更新。</div>
            )}
          </div>
        </section>

        <div className={styles.twoCol}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.code}>M-B6</span>
              <h2>來源健康</h2>
              <em>{finmind ? finmind.datasets.length : 0} 組</em>
            </div>
            <div className={styles.sourceGrid}>
              {datasets.length > 0 ? datasets.map((dataset) => (
                <div className={styles.sourceCard} key={dataset.key}>
                  <div>
                    <span>{dataset.label}</span>
                    <b className={datasetTone(dataset.state)}>{datasetStateLabel(dataset.state)}</b>
                  </div>
                  <p>{dataset.key}</p>
                  <small>{dataset.rowCount?.toLocaleString("zh-TW") ?? "--"} 筆 · {datasetAge(dataset)}</small>
                </div>
              )) : (
                <div className={styles.emptyState}>{health.error ?? "FinMind 來源狀態待連線。"}</div>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.code}>M-B8</span>
              <h2>Data readiness</h2>
              <em>{readiness}%</em>
            </div>
            <div className={styles.timeline}>
              {timelineRows(result, finmind).map((row) => (
                <div className={styles.timelineRow} key={row.label}>
                  <span>{row.label}</span>
                  <i className={row.state === "fresh" ? styles.freshDot : styles.reviewDot} />
                  <b>{row.time}</b>
                </div>
              ))}
            </div>
            <div className={styles.legend}>
              <span><i className={styles.freshDot} />新鮮</span>
              <span><i className={styles.reviewDot} />待確認</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
