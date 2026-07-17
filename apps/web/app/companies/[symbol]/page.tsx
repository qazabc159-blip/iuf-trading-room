// /companies/[symbol]/page.tsx ??Server Component
// 9-panel company surface on top of live contracts-shape Company + OHLCV.
// HeroBar / OHLCV chart / CompanyInfo / Chips / Announcements / Financials bind
// to /api/v1. Panels without a production contract render BLOCKED, not mock data.
//
// HARD LINE: never import KGI SDK or call broker live submit path.

import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { MarketStateBanner } from "@/components/MarketStateBanner";
import { getCompanyAnnouncements, getCompanyByTicker, getCompanyFullProfile, getCompanyKBar, getCompanyOhlcv, getCompanyQuoteRealtime, getThemes, type CompanyRealtimeQuote, type FinMindKBarView, type FullProfileEnvelope, type OhlcvBar } from "@/lib/api";
import type { Company, Theme } from "@iuf-trading-room/contracts";
import {
  quoteFromOhlcvBars,
  type SourceStatus,
  toCompanyDetailView,
} from "@/lib/company-adapter";
import { industryLabel } from "@/lib/industry-i18n";
import { resolveBannerLastCloseDate } from "@/lib/index-snapshot-freshness";

import { CompanyHeroBar }      from "./CompanyHeroBar";
import { CompanyInfoPanel }    from "./CompanyInfoPanel";
import { OhlcvCandlestickChart } from "./OhlcvCandlestickChart";
import { FinancialsPanel }     from "./FinancialsPanel";
import { ChipsPanel }          from "./ChipsPanel";
import { AnnouncementsPanel }  from "./AnnouncementsPanel";
import { SourceStatusCard }    from "./SourceStatusCard";
// DerivativesPanel intentionally not imported/rendered — 權證/選擇權資料源未接入，
// 產品化收板決議整塊移除（不留「即將推出」空佔位）。Component file kept in tree for
// when the data source lands; re-enable via import + render below when ready.
import { TickStreamPanel }     from "./TickStreamPanel";
import { FullProfilePanels }   from "./FullProfilePanels";
import { CompanyPageStyleBlock } from "./CompanyPageStyleBlock";
import { BidAskPanel }           from "./BidAskPanel";
import { LiveTickStreamPanel }   from "./LiveTickStreamPanel";
import { InstitutionalPanel }    from "./InstitutionalPanel";
import { MarginShortPanel }      from "./MarginShortPanel";
import { CoverageKnowledgePanel } from "./CoverageKnowledgePanel";
import { IndustryGraphPanel }    from "./IndustryGraphPanel";
import { AiAnalystReportPanel }  from "./AiAnalystReportPanel";

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

const tierLabel: Record<string, string> = {
  Core: "核心受惠",
  Direct: "直接受惠",
  Indirect: "間接受惠",
  Observation: "觀察",
};

const marketLabel: Record<string, string> = {
  TWSE: "上市",
  TPEX: "上櫃",
  OTC: "上櫃",
};

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function fmtMarketCap(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(1)}兆`;
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(1)}億`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(0)}萬`;
  return value.toLocaleString("zh-TW");
}

function momentumFromChange(value: number | null | undefined) {
  if (typeof value !== "number") return "待接";
  if (value > 1) return "偏強";
  if (value < -1) return "偏弱";
  return "中性";
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|fetch failed|ECONNREFUSED|network/i.test(message)) return "前端暫時無法連到後端。";
  if (/401|unauthorized|unauthenticated/i.test(message)) return "登入狀態已失效，請重新登入。";
  if (/404|not found/i.test(message)) return "後端端點尚未提供。";
  return "資料暫時無法讀取。";
}

function companyTimestamp(company: Company) {
  const record = company as unknown as { updatedAt?: string; createdAt?: string };
  return record.updatedAt ?? record.createdAt ?? new Date().toISOString();
}

function displayThemeName(theme: Theme) {
  const raw = (theme.name || theme.slug).trim();
  if (!raw) return theme.slug;
  return raw.replace(/^\[ORPHAN\]\s*/i, "待歸檔：").replace(/-\>/g, "→");
}

function CompanySideNavPanel() {
  const items = [
    { href: "#sec-kline", label: "K 線圖", meta: "技術面" },
    { href: "#sec-quote", label: "五檔 / 逐筆", meta: "即時行情" },
    { href: "#sec-fin", label: "財報與估值", meta: "七分頁" },
    { href: "#company-knowledge", label: "知識 / 上下游圖譜", meta: "產業鏈" },
    { href: "#sec-chips", label: "法人 / 融資融券", meta: "籌碼" },
    { href: "#sec-hold", label: "外資持股 / 分佈", meta: "股權" },
    { href: "#sec-detail", label: "成交明細", meta: "逐筆" },
    { href: "#sec-news", label: "重大訊息", meta: "公告" },
    { href: "#company-ai-report", label: "AI 分析師報告", meta: "九段" },
    { href: "#sec-theme", label: "主題受惠", meta: "分類" },
    { href: "#company-full-profile", label: "完整資料區", meta: "FinMind [06]-[11]" },
    { href: "#company-source-status", label: "資料來源", meta: "狀態" },
  ];

  return (
    <section className="panel hud-frame company-side-nav-panel" aria-label="公司頁索引">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">頁面索引</span>
      </h3>
      <nav className="company-side-nav-list">
        {items.map((item) => (
          <a key={item.href} className="company-side-nav-link" href={item.href}>
            <span>{item.label}</span>
            <small>{item.meta}</small>
          </a>
        ))}
      </nav>
    </section>
  );
}

/** Y3 fix: map real announcements fetch result to SourceHealthState (no hardcoded "stale"). */
type AnnouncementsSourceState =
  | { outcome: "live"; count: number; fetchedAt: string }
  | { outcome: "empty"; fetchedAt: string }
  | { outcome: "degraded"; fetchedAt: string }
  | { outcome: "error"; fetchedAt: string };

function buildSourceStatus(
  company: Company,
  bars: OhlcvBar[],
  ohlcvReason: string,
  kbar: { state: string; reason: string; rows: number; date: string },
  announcementsSource: AnnouncementsSourceState,
): SourceStatus[] {
  const lastBar = bars.at(-1);
  const lastBarTime = lastBar ? new Date(`${lastBar.dt}T13:30:00+08:00`).toISOString() : new Date().toISOString();
  const priceSource = lastBar?.source === "tej" ? "FinMind/TEJ 正式 K 線" : lastBar?.source === "kgi" ? "KGI 唯讀報價" : null;
  const kbarLive = kbar.state === "LIVE" && kbar.rows > 0;

  // Map announcements outcome → SourceHealthState (LIVE/STALE/EMPTY/BLOCKED/DEGRADED/ERROR all supported by SourceStatusCard)
  const annState: SourceStatus["state"] =
    announcementsSource.outcome === "live" ? "live" :
    announcementsSource.outcome === "empty" ? "stale" :
    "error";

  const annSummary =
    announcementsSource.outcome === "live"
      ? `${announcementsSource.count} 則重大訊息 (近 30 日)`
      : announcementsSource.outcome === "empty"
      ? "近 30 日無重大訊息"
      : "重大訊息資料暫時無法讀取";

  const annDetail =
    announcementsSource.outcome === "live"
      ? `已從臺灣證交所取得 ${announcementsSource.count} 則近 30 日重大訊息。`
      : announcementsSource.outcome === "empty"
      ? "TWSE 回傳空資料 — 近 30 日無重大訊息，非異常。"
      : announcementsSource.outcome === "degraded"
      ? "TWSE OpenAPI 返回非 JSON 內容 (維護模式)；重大訊息暫時無法讀取。"
      : "無法連線至 TWSE OpenAPI，請稍後重試。";

  return [
    {
      id: "company-master",
      label: "公司主檔",
      state: "live",
      summary: "工作區公司資料",
      lastSeen: companyTimestamp(company),
      detail: "已在登入工作區找到這檔股票。",
      queueDepth: 0,
    },
    {
      id: "ohlcv",
      label: "K 線",
      state: lastBar && priceSource ? "live" : "error",
      summary: priceSource ?? "尚無正式 K 線",
      lastSeen: lastBarTime,
      detail: lastBar
        ? `已讀取 ${bars.length} 根正式 K 線；最新來源 ${lastBar.source}。`
        : ohlcvReason,
      queueDepth: 0,
    },
    {
      id: "twse-announcements",
      label: "重大訊息",
      state: annState,
      summary: annSummary,
      lastSeen: announcementsSource.fetchedAt,
      detail: annDetail,
      queueDepth: 0,
    },
    {
      id: "finmind-kbar",
      label: "分 K",
      state: kbarLive ? "live" : kbar.state === "BLOCKED" ? "error" : "stale",
      summary: kbarLive ? `FinMind ${kbar.date} / ${kbar.rows} 根` : "FinMind 分 K 尚未可用",
      lastSeen: new Date().toISOString(),
      detail: kbarLive
        ? "已接 FinMind Sponsor 分 K；日內 1/5/15/60 分鐘由同一批真實分 K 彙整，不使用假線。"
        : kbar.reason,
      queueDepth: 0,
    },
    {
      id: "kgi-ticks",
      label: "逐筆資料",
      state: "error",
      summary: "等待凱基唯讀逐筆資料",
      lastSeen: new Date().toISOString(),
      detail: "目前不顯示假逐筆；待唯讀資料接上後啟用。",
      queueDepth: 0,
    },
  ];
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;

  let company: Company | null = null;
  let fetchErrorMsg: string | null = null;
  try {
    company = await getCompanyByTicker(symbol);
  } catch (err) {
    fetchErrorMsg = friendlyError(err);
    console.warn("[company-detail] getCompanyByTicker degraded", { symbol, err: fetchErrorMsg });
  }

  if (fetchErrorMsg !== null) {
    return (
      <PageFrame
        code="03-ERR"
        title={symbol.toUpperCase()}
        sub="公司資料暫時無法讀取"
        note={`公司板 / ${symbol} / 暫停`}
      >
        <div style={{ padding: "32px 24px", fontSize: 14, lineHeight: 1.8, maxWidth: 980 }}>
          <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 10, fontSize: 16, fontWeight: 700 }}>
            {symbol.toUpperCase()} 公司資料暫時無法讀取
          </div>
          <div className="dim" style={{ marginBottom: 18 }}>
            這不是正式公司資料內容，也不會補假 K 線、假報價或假 AI 報告。系統已進入公司頁降級狀態，下面列出缺哪個資料源與下一步。
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 18 }}>
            <div className="panel hud-frame" style={{ padding: 14 }}>
              <b className="tg">缺少資料源</b>
              <div className="tg soft">公司主檔查詢</div>
              <small className="dim">公司主檔查詢沒有成功回傳，因此公司頁不能安全渲染 quote / K 線 / AI report。</small>
            </div>
            <div className="panel hud-frame" style={{ padding: 14 }}>
              <b className="tg">目前狀態</b>
              <div className="tg soft">{fetchErrorMsg}</div>
              <small className="dim">若為登入狀態或網路問題，頁面會保持降級，不使用假資料填補。</small>
            </div>
            <div className="panel hud-frame" style={{ padding: 14 }}>
              <b className="tg">下一步</b>
              <div className="tg soft">等待正式公司資料恢復</div>
              <small className="dim">資料恢復後，此頁會重新顯示正式資料面板。</small>
            </div>
          </div>
          <div className="terminal-note compact" style={{ marginBottom: 16 }}>
            前端保護：公司主檔缺失時只顯示上方暫停狀態，不渲染空白區塊，也不使用假資料。
          </div>
          <Link href="/companies" className="btn-sm">返回公司列表</Link>
        </div>
      </PageFrame>
    );
  }

  if (!company) {
    console.warn("[company-detail] ticker not found in workspace", {
      symbol,
    });
    return (
      <PageFrame
        code="03-NF"
        title={symbol.toUpperCase()}
        sub="查無此股票"
        note={`公司板 / ${symbol} / 無資料`}
      >
        <div style={{ padding: "32px 24px", fontFamily: "var(--mono, monospace)", fontSize: 12 }}>
          <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 12 }}>
            查無 {symbol.toUpperCase()}
          </div>
          <div className="dim" style={{ marginBottom: 16 }}>
            目前公司查詢端點沒有回傳符合代號 <b>{symbol}</b> 的股票。
          </div>
          <div className="terminal-note compact" style={{ marginBottom: 16 }}>
            資料源：公司主檔查詢。下一步：確認該股票是否存在於公司主檔，或由資料匯入流程補入；前端不會用假公司資料填補。
          </div>
          <Link href="/companies" className="btn-sm">返回公司列表</Link>
        </div>
      </PageFrame>
    );
  }

  // Kick off in parallel with the rest of the page's fetches — feeds
  // <MarketStateBanner lastCloseDate> so the banner date can't disagree with
  // the heatmap/index date shown elsewhere (see index-snapshot-freshness.ts).
  const lastCloseDatePromise = resolveBannerLastCloseDate().catch(() => null);

  // ── Phase 1: fetch OHLCV (needed for kbarDate) ──────────────────────────────
  let ohlcvErrorMsg: string | null = null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - 10);
  const rawBars: OhlcvBar[] = await getCompanyOhlcv(company.id, { interval: "1d", from: from.toISOString().slice(0, 10) }).catch((err) => {
    ohlcvErrorMsg = friendlyError(err);
    console.warn("[company-detail] getCompanyOhlcv failed", { id: company.id, err });
    return [];
  });
  const bars = rawBars.filter((bar) => bar.source !== "mock");
  const ohlcvState = ohlcvErrorMsg ? "BLOCKED" : bars.length > 0 ? "LIVE" : "EMPTY";
  const ohlcvReason = ohlcvErrorMsg
    ? `K 線資料暫時無法讀取：${ohlcvErrorMsg}`
    : "此股票目前沒有可用的正式 K 線資料。";
  const kbarDate = bars.at(-1)?.dt ?? new Date().toISOString().slice(0, 10);

  // ── Phase 2: kbar + themes + announcements + realtime quote + full-profile in parallel ──
  // Previously 4 concurrent fetches. Now 5 — full-profile for PE / yield / monthly revenue.
  const fetchedAt = new Date().toISOString();
  const [kbarResult, themesResult, announcementsResult, realtimeResult, fullProfileResult] = await Promise.allSettled([
    getCompanyKBar(company.id, kbarDate, { days: 20 }),
    getThemes(),
    getCompanyAnnouncements(company.id, { days: 30 }),
    getCompanyQuoteRealtime(company.id),
    getCompanyFullProfile(company.id),
  ]);

  // kbar
  let kbarView: FinMindKBarView | null = null;
  let kbarErrorMsg: string | null = null;
  if (kbarResult.status === "fulfilled") {
    kbarView = kbarResult.value.data;
  } else {
    kbarErrorMsg = friendlyError(kbarResult.reason);
    console.warn("[company-detail] getCompanyKBar failed", { id: company.id, date: kbarDate, err: kbarErrorMsg });
  }
  const kbarState = kbarErrorMsg ? "BLOCKED" : kbarView?.state ?? "EMPTY";
  const kbarReason = kbarErrorMsg
    ? `FinMind 分 K 暫時無法讀取：${kbarErrorMsg}`
    : kbarView?.reason ?? "FinMind 分 K 尚未回傳資料。";

  // themes
  const themeLabelById = new Map<string, string>();
  if (themesResult.status === "fulfilled") {
    for (const theme of themesResult.value.data ?? []) {
      themeLabelById.set(theme.id, displayThemeName(theme));
    }
  } else {
    console.warn("[company-detail] getThemes failed; hiding raw theme ids", { symbol, err: friendlyError(themesResult.reason) });
  }

  // announcements probe (for SourceStatusCard badge only)
  let announcementsSource: Parameters<typeof buildSourceStatus>[4];
  if (announcementsResult.status === "fulfilled") {
    const annRes = announcementsResult.value;
    const envelope = annRes as typeof annRes & { state?: string };
    if (envelope.state === "DEGRADED") {
      announcementsSource = { outcome: "degraded", fetchedAt };
    } else {
      const items = annRes.data ?? [];
      announcementsSource = items.length > 0
        ? { outcome: "live", count: items.length, fetchedAt }
        : { outcome: "empty", fetchedAt };
    }
  } else {
    console.warn("[company-detail] getCompanyAnnouncements probe failed", { id: company.id, err: friendlyError(announcementsResult.reason) });
    announcementsSource = { outcome: "error", fetchedAt };
  }

  // realtime quote (fail-soft: null = gateway not reachable or BLOCKED)
  const realtimeQuote: CompanyRealtimeQuote | null =
    realtimeResult.status === "fulfilled" ? realtimeResult.value : null;
  // CLOSE = today's session close served off-hours (6/15 fix) — has a real
  // price, so the badge must show it, not「等待即時」.
  const realtimeLive = realtimeQuote?.state === "LIVE" || realtimeQuote?.state === "STALE" || realtimeQuote?.state === "CLOSE";

  // full-profile fundamentals for hero KPI strip (fail-soft: null = endpoint unavailable)
  let fullProfile: FullProfileEnvelope | null = null;
  if (fullProfileResult.status === "fulfilled") {
    fullProfile = fullProfileResult.value.data;
  } else {
    console.warn("[company-detail] getCompanyFullProfile failed (hero KPI degraded)", { id: company.id, err: friendlyError(fullProfileResult.reason) });
  }
  const heroValuation = fullProfile?.marketIntel?.valuation;
  const heroPE: number | null = heroValuation?.latest?.pe ?? null;
  const heroDividendYield: number | null = heroValuation?.latest?.dividendYield ?? null;
  const heroRevenue: FullProfileEnvelope["fundamentals"]["monthlyRevenue"]["latest"] | null =
    fullProfile?.fundamentals?.monthlyRevenue?.latest ?? null;

  const detail = toCompanyDetailView(company, symbol, themeLabelById);
  const quote = quoteFromOhlcvBars(bars);
  const sources = buildSourceStatus(company, bars, ohlcvReason, {
    state: kbarState,
    reason: kbarReason,
    rows: kbarView?.rows.length ?? 0,
    date: kbarView?.date ?? kbarDate,
  }, announcementsSource);
  const dailyChangePct = quote?.changePercent ?? null;
  const kbarRowCount = kbarView?.rows.length ?? 0;
  const kbarLive = kbarState === "LIVE" && kbarRowCount > 0;

  // ── Round 2: Supplemental HUD stats (all from existing payloads — zero new backend calls) ──
  // 振幅: today's (high-low)/prevClose — uses realtimeQuote fields
  const refPrice = realtimeQuote?.referencePrice ?? realtimeQuote?.prevClose
                   ?? realtimeQuote?.previousClose ?? realtimeQuote?.yesterdayClose ?? null;
  const todayHigh = realtimeQuote?.high ?? (bars.length > 0 ? bars[bars.length - 1].high : null);
  const todayLow  = realtimeQuote?.low  ?? (bars.length > 0 ? bars[bars.length - 1].low  : null);
  const amplitude = (refPrice && refPrice > 0 && todayHigh != null && todayLow != null)
    ? ((todayHigh - todayLow) / refPrice) * 100
    : null;
  // 52週高低: max/min high/low over last 252 bars
  const w52Bars = bars.slice(-252);
  const w52High = w52Bars.length > 0 ? Math.max(...w52Bars.map(b => b.high)) : null;
  const w52Low  = w52Bars.length > 0 ? Math.min(...w52Bars.map(b => b.low))  : null;
  // 市值 / PBR: from full-profile (already fetched)
  const heroMarketCap: number | null = fullProfile?.marketIntel?.marketValue?.latest?.marketValue ?? null;
  const heroPBR:       number | null = fullProfile?.marketIntel?.valuation?.latest?.pbr ?? null;
  const lastCloseDate = await lastCloseDatePromise;

  return (
    <PageFrame
      code={`03-${company.ticker}`}
      title={company.ticker}
      sub={`${company.name} / ${marketLabel[company.market] ?? company.market}`}
      note={`公司板 / ${company.ticker} / ${industryLabel(company.chainPosition)} / ${tierLabel[company.beneficiaryTier] ?? company.beneficiaryTier}`}
    >
      <CompanyPageStyleBlock />
      <MarketStateBanner lastCloseDate={lastCloseDate} />
      <div className="co-v3-page">
      <div style={{ marginBottom: 10 }}>
        <a href="/companies" className="_co-back-btn">
          ← 返回公司列表
        </a>
      </div>

      <CompanyHeroBar
        company={detail}
        quote={quote}
        realtimeQuote={realtimeQuote}
        lastBar={bars.length > 0 ? bars[bars.length - 1] : null}
        pe={heroPE}
        dividendYield={heroDividendYield}
        latestRevenue={heroRevenue?.revenue ?? null}
      />

      {/* ── Round 2: HUD Stats Strip — 振幅 / 52週高低 / 市值 / PBR ── */}
      <div className="_co-hud-stats-strip">
        <div className="_co-hud-stat-cell">
          <div className="_co-hud-stat-lbl">振幅</div>
          <div className="_co-hud-stat-val">
            {amplitude !== null ? `${amplitude.toFixed(2)}%` : "--"}
          </div>
        </div>
        <div className="_co-hud-stat-cell">
          <div className="_co-hud-stat-lbl">52週高</div>
          <div className="_co-hud-stat-val _co-hud-up">
            {w52High !== null ? w52High.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : "--"}
          </div>
        </div>
        <div className="_co-hud-stat-cell">
          <div className="_co-hud-stat-lbl">52週低</div>
          <div className="_co-hud-stat-val _co-hud-dn">
            {w52Low !== null ? w52Low.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : "--"}
          </div>
        </div>
        <div className="_co-hud-stat-cell">
          <div className="_co-hud-stat-lbl">市值</div>
          <div className="_co-hud-stat-val">
            {heroMarketCap !== null ? fmtMarketCap(heroMarketCap) : "--"}
          </div>
          <div className="_co-hud-stat-sub">TWD</div>
        </div>
        <div className="_co-hud-stat-cell">
          <div className="_co-hud-stat-lbl">本淨比</div>
          <div className="_co-hud-stat-val">
            {heroPBR !== null && Number.isFinite(heroPBR) ? heroPBR.toFixed(2) : "--"}
          </div>
          <div className="_co-hud-stat-sub">倍</div>
        </div>
        <div className="_co-hud-stat-cell">
          <div className="_co-hud-stat-lbl">分K狀態</div>
          <div className={`_co-hud-stat-val ${kbarLive ? "_co-hud-dn" : ""}`} style={{ fontSize: 11 }}>
            {kbarLive ? `${kbarRowCount.toLocaleString("zh-TW")} 根` : kbarState === "BLOCKED" ? "暫停" : "無資料"}
          </div>
        </div>
      </div>

      <div className="company-detail-layout">
        <div className="company-main-column">
          {/* ── K 線圖：既有 OhlcvCandlestickChart 引擎原封裝入（禁重寫），
               週期/範圍/分K視窗/均線/RSI/MACD 切換皆元件自帶 chrome ── */}
          <div id="sec-kline" className="company-workbench-shell">
            <OhlcvCandlestickChart
              bars={bars}
              kbarRows={kbarView?.rows ?? []}
              kbarState={kbarState}
              kbarReason={kbarReason}
              kbarDate={kbarView?.date ?? kbarDate}
              symbol={company.ticker}
              sourceState={ohlcvState}
              sourceReason={ohlcvReason}
            />
          </div>

          {/* ── 五檔委買委賣 | 逐筆即時成交 — 等高並排（DESIGN_NOTES §三 #5/#6） ── */}
          <div id="sec-quote" className="co-v3-pairrow">
            <BidAskPanel symbol={company.ticker} />
            <LiveTickStreamPanel symbol={company.ticker} />
          </div>

          {/* ── 財報與估值：既有 7-tab FinancialsPanel（財報/月營收/資產負債/現金流/估值/市值/股利） ── */}
          <div id="sec-fin">
            <FinancialsPanel companyId={company.id} />
          </div>

          {/* ── 知識圖譜 | 上下游圖譜（DESIGN_NOTES §三 #8/#9） ── */}
          <div id="company-knowledge" className="co-v3-pairrow">
            <CoverageKnowledgePanel ticker={company.ticker} />
            <IndustryGraphPanel
              ticker={company.ticker}
              companyName={company.name}
            />
          </div>

          {/* ── 法人籌碼 | 融資融券（DESIGN_NOTES §三 #11/#12） ── */}
          <div id="sec-chips" className="co-v3-pairrow">
            <InstitutionalPanel companyId={company.id} />
            <MarginShortPanel companyId={company.id} />
          </div>

          {/* ── 外資持股與分佈（DESIGN_NOTES §三 #17，`#sec-hold`）。2026-07-17 已拆分：
               ChipsPanel 收斂為純外資持股/股權分散單一職責，不再與上方 InstitutionalPanel/
               MarginShortPanel 的三大法人/融資券 30 日表重複。 ── */}
          <ChipsPanel companyId={company.id} />

          {/* ── 逐筆成交明細 full-width（DESIGN_NOTES §三 #19） ── */}
          <div id="sec-detail">
            <TickStreamPanel
              symbol={company.ticker}
              kbarRows={kbarView?.rows ?? []}
              kbarState={kbarState}
              kbarReason={kbarReason}
            />
          </div>

          {/* ── 重大訊息 full-width（DESIGN_NOTES §三 #18） ── */}
          <div id="sec-news">
            <AnnouncementsPanel companyId={company.id} />
          </div>

          {/* ── AI 分析師深度報告 ── */}
          <div id="company-ai-report">
            <AiAnalystReportPanel ticker={company.ticker} />
          </div>

          {/* ── 主題受惠（DESIGN_NOTES §三 #14） ── */}
          {detail.themes.length > 0 && (
            <div id="sec-theme" className="panel hud-frame">
              <h3 className="ascii-head">
                <span className="ascii-head-bracket">主題受惠</span>
                <span className="tg soft" style={{ marginLeft: 8, fontSize: 10 }}>產業主題 / 受惠分類</span>
              </h3>
              <div className="_co-theme-grid">
                {detail.themes.map((theme) => (
                  <div key={theme} className="_co-theme-card" style={{ "--_accent": "rgba(200,148,63,0.62)" } as React.CSSProperties}>
                    <div className="_co-theme-name">{theme}</div>
                    <div className="_co-theme-tier">{tierLabel[detail.beneficiaryTier] ?? detail.beneficiaryTier}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="company-side-column">
          <CompanyInfoPanel company={company} />
          <CompanySideNavPanel />
          <div id="company-source-status">
            <SourceStatusCard sources={sources} />
          </div>
        </aside>
      </div>

      {/* 完整資料區 — 沿用既有 FullProfilePanels（[06]-[11] 延伸細表）不動；
          2026-07-12 D5 dedup 已把公告展開 UI 收斂到 AnnouncementsPanel 並保留此區為連結出口，
          本輪不重複拆解（見 tests/ci.test.ts COMPANY-ANN-DETAIL-UI-1 guard）。 */}
      <div id="company-full-profile" className="_co-section-banner">
        <span className="_co-section-banner-title">完整資料區</span>
        <span className="_co-section-banner-sub">FinMind 11 資料集（[06]–[11]）</span>
        <div className="_co-section-banner-tags">
          <span>財報</span><span>月營收</span><span>法人</span><span>融資券</span><span>股利</span><span>公告</span>
        </div>
        <div className="_co-section-banner-desc">財報、月營收、法人籌碼、融資融券、股利政策、重大訊息；資料源狀態不足時會誠實顯示無資料或暫停，不補假。</div>
      </div>

      <FullProfilePanels companyId={company.id} />
      </div>

    </PageFrame>
  );
}
