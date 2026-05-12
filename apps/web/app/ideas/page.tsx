import Link from "next/link";

import { getStrategyIdeas } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

import { StrategyIdeasV03Client, type IdeasLoadStateV03, type IdeasViewV03 } from "./StrategyIdeasV03Client";
import styles from "./strategy-ideas-v03.module.css";

export const dynamic = "force-dynamic";

type ApiIdeasView = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];

const emptyIdeas: IdeasViewV03 = {
  generatedAt: new Date(0).toISOString(),
  summary: {
    total: 0,
    allow: 0,
    review: 0,
    block: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    quality: { strategyReady: 0, referenceOnly: 0, insufficient: 0, primaryReasons: [] },
  },
  items: [],
};

function normalizeIdeas(data: ApiIdeasView): IdeasViewV03 {
  return data as unknown as IdeasViewV03;
}

async function loadIdeas(): Promise<IdeasLoadStateV03> {
  const source = "正式策略資料";
  const updatedAt = new Date().toISOString();
  try {
    const envelope = await getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 30, sort: "score" });
    const data = normalizeIdeas(envelope.data);
    if (data.items.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt: data.generatedAt || updatedAt,
        source,
        reason: "目前沒有可顯示的正式策略想法。",
      };
    }
    return { state: "LIVE", data, updatedAt: data.generatedAt || updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyIdeas,
      updatedAt,
      source,
      reason: friendlyDataError(error, "策略想法暫時無法讀取。"),
    };
  }
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

function stateLabel(state: IdeasLoadStateV03["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無候選";
  return "暫停";
}

function stateClass(state: IdeasLoadStateV03["state"]) {
  if (state === "LIVE") return styles.ok;
  if (state === "EMPTY") return styles.warn;
  return styles.bad;
}

export default async function IdeasPage() {
  const result = await loadIdeas();
  const summary = result.data.summary;
  const avgConfidence = result.data.items.length
    ? result.data.items.reduce((sum, item) => sum + item.confidence, 0) / result.data.items.length
    : 0;

  return (
    <div className={styles.page}>
      <div className={styles.bgGrid} />
      <aside className={styles.nav}>
        <div className={styles.brandBar}><i /><span>IUF · IDEAS</span></div>
        <h1>情報—決策—倉位</h1>
        <p>策略想法</p>

        <div className={styles.navGroup}>情報入口</div>
        <Link className={styles.navLink} href="/market-intel"><span>7a</span>市場情報</Link>

        <div className={styles.navGroup}>策略決策</div>
        <Link className={`${styles.navLink} ${styles.active}`} href="/ideas"><span>7b</span>策略想法</Link>
        <Link className={styles.navLinkMuted} href="/runs"><span>7c</span>策略批次</Link>

        <div className={styles.navGroup}>執行</div>
        <Link className={styles.navLink} href="/portfolio"><span>7d</span>模擬交易室</Link>
        <Link className={styles.navLinkMuted} href="/alerts"><span>07</span>警示</Link>
      </aside>

      <main className={styles.content}>
        <header className={styles.header}>
          <div>
            <div className={styles.crumb}>IUF / 情報—決策—倉位 / 策略想法</div>
            <h1>候選，不是建議。</h1>
            <p>這裡把台股候選依資料品質、訊號數、主題連結與市場資料完整度排序，供研究與紙上交易預覽使用。</p>
          </div>
          <div className={styles.headerRight}>
            <span>{formatDateTime(result.updatedAt)} TPE</span>
            <b className={stateClass(result.state)}>{stateLabel(result.state)}</b>
          </div>
        </header>

        <div className={styles.safety}>
          <i />
          <span>本頁不提供買賣建議、不顯示保證績效；所有候選必須再進公司頁與 Paper Preview。</span>
          <b>RESEARCH ONLY</b>
        </div>

        <section className={styles.summaryBand}>
          <div className={styles.summaryCopy}>
            <span className={styles.code}>S-I3 · CANDIDATE GATE</span>
            <h2>目前 {summary.allow} 檔可觀察，{summary.review} 檔待審，{summary.block} 檔不進流程。</h2>
            <p>分數只代表研究排序；真正能不能進一步，需要看資料完整度、來源新鮮度與風控預覽。</p>
          </div>
          <div className={styles.metrics}>
            <div><span>候選總數</span><b>{summary.total}</b></div>
            <div><span>平均信心</span><b>{Math.round(avgConfidence * 100)}%</b></div>
            <div><span>策略可用</span><b>{summary.quality.strategyReady}</b></div>
            <div><span>資料不足</span><b>{summary.quality.insufficient}</b></div>
          </div>
        </section>

        {result.state !== "LIVE" && (
          <div className={styles.notice}>
            <b>{stateLabel(result.state)}</b>
            <span>{"reason" in result ? result.reason : "策略候選尚未產生。"}</span>
          </div>
        )}

        <StrategyIdeasV03Client result={result} />
      </main>
    </div>
  );
}
