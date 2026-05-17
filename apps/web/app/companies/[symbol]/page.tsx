// /companies/[symbol]/page.tsx ??Server Component
// 9-panel company surface on top of live contracts-shape Company + OHLCV.
// HeroBar / OHLCV chart / CompanyInfo / Chips / Announcements / Financials bind
// to /api/v1. Panels without a production contract render BLOCKED, not mock data.
//
// HARD LINE: never import KGI SDK or call broker live submit path.

import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { getCompanies, getCompanyAnnouncements, getCompanyFullProfile, getCompanyKBar, getCompanyOhlcv, getCompanyQuoteRealtime, getThemes, type CompanyRealtimeQuote, type FinMindKBarView, type FullProfileEnvelope, type OhlcvBar } from "@/lib/api";
import type { Company, Theme } from "@iuf-trading-room/contracts";
import {
  quoteFromOhlcvBars,
  type SourceStatus,
  toCompanyDetailView,
} from "@/lib/company-adapter";
import { industryLabel } from "@/lib/industry-i18n";

import { CompanyHeroBar }      from "./CompanyHeroBar";
import { CompanyInfoPanel }    from "./CompanyInfoPanel";
import { OhlcvCandlestickChart } from "./OhlcvCandlestickChart";
import { FinancialsPanel }     from "./FinancialsPanel";
import { ChipsPanel }          from "./ChipsPanel";
import { AnnouncementsPanel }  from "./AnnouncementsPanel";
import { SourceStatusCard }    from "./SourceStatusCard";
import { DerivativesPanel }    from "./DerivativesPanel";
import { TickStreamPanel }     from "./TickStreamPanel";
import { FullProfilePanels }   from "./FullProfilePanels";
import { CompanyPageStyleBlock } from "./CompanyPageStyleBlock";
import { BidAskPanel }           from "./BidAskPanel";
import { LiveTickStreamPanel }   from "./LiveTickStreamPanel";
import { InstitutionalPanel }    from "./InstitutionalPanel";
import { MarginShortPanel }      from "./MarginShortPanel";
import { CoverageKnowledgePanel } from "./CoverageKnowledgePanel";
import { IndustryGraphPanel }    from "./IndustryGraphPanel";

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

  let companies: Company[] = [];
  let fetchErrorMsg: string | null = null;
  try {
    const res = await getCompanies();
    companies = res.data ?? [];
  } catch (err) {
    fetchErrorMsg = friendlyError(err);
    console.error("[company-detail] getCompanies failed", { symbol, err: fetchErrorMsg });
  }

  if (fetchErrorMsg !== null) {
    return (
      <PageFrame
        code="03-ERR"
        title={symbol.toUpperCase()}
        sub="公司資料暫時無法讀取"
        note={`公司板 / ${symbol} / 暫停`}
      >
        <div style={{ padding: "32px 24px", fontSize: 14, lineHeight: 1.8 }}>
          <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 16, fontSize: 16, fontWeight: 700 }}>
            {symbol.toUpperCase()} 公司資料暫時無法讀取
          </div>
          <div className="dim" style={{ marginBottom: 16 }}>
            目前登入工作區或後端公司資料服務沒有回應；請稍後重試，或檢查後端與登入狀態。
          </div>
          <div className="terminal-note compact">{fetchErrorMsg}</div>
          <Link href="/companies" className="btn-sm">返回公司列表</Link>
        </div>
      </PageFrame>
    );
  }

  const needle = symbol.toLowerCase();
  const company = companies.find((c) => c.ticker.toLowerCase() === needle) ?? null;

  if (!company) {
    console.warn("[company-detail] ticker not found in workspace", {
      symbol,
      workspaceSize: companies.length,
      sample: companies.slice(0, 5).map((c) => c.ticker),
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
            目前工作區有 {companies.length} 檔公司資料，但沒有符合代號 <b>{symbol}</b> 的股票。
          </div>
          {companies.length > 0 && (
            <div className="dim" style={{ marginBottom: 16 }}>
              可用範例：{companies.slice(0, 8).map((c) => c.ticker).join(" / ")}
            </div>
          )}
          <Link href="/companies" className="btn-sm">返回公司列表</Link>
        </div>
      </PageFrame>
    );
  }

  // ── Phase 1: fetch OHLCV (needed for kbarDate) ──────────────────────────────
  let ohlcvErrorMsg: string | null = null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - 3);
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
  const realtimeLive = realtimeQuote?.state === "LIVE" || realtimeQuote?.state === "STALE";

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

  return (
    <PageFrame
      code={`03-${company.ticker}`}
      title={company.ticker}
      sub={`${company.name} / ${marketLabel[company.market] ?? company.market}`}
      note={`公司板 / ${company.ticker} / ${industryLabel(company.chainPosition)} / ${tierLabel[company.beneficiaryTier] ?? company.beneficiaryTier}`}
    >
      <CompanyPageStyleBlock />
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

      <div className="company-kpi-strip">
        <div>
          <span className="tg soft">資料</span>
          <b className={`tg ${ohlcvState === "LIVE" ? "up" : ohlcvState === "BLOCKED" ? "down" : "gold"}`}>
            {ohlcvState === "LIVE" ? "日K已接" : ohlcvState === "BLOCKED" ? "日K暫停" : "日K無資料"}
          </b>
        </div>
        <div>
          <span className="tg soft">動能</span>
          <b className={`tg ${tone(dailyChangePct)}`}>{momentumFromChange(dailyChangePct)}</b>
        </div>
        <div>
          <span className="tg soft">分K</span>
          <b className={`tg ${kbarLive ? "up" : kbarState === "BLOCKED" ? "down" : "gold"}`}>
            {kbarLive ? `${kbarRowCount.toLocaleString("zh-TW")}根` : kbarState === "BLOCKED" ? "分K暫停" : "分K無資料"}
          </b>
        </div>
        <div>
          <span className="tg soft">日變動</span>
          <b className={`num ${tone(dailyChangePct)}`}>{signed(dailyChangePct)}%</b>
        </div>
        {/* Realtime badge — shows LIVE when EC2 KGI gateway returns fresh tick */}
        <div>
          <span className="tg soft">即時</span>
          <b className={`tg ${realtimeLive ? "up" : "muted"}`}>
            {realtimeLive
              ? `${realtimeQuote?.state === "LIVE" ? "即時" : "略舊"}${realtimeQuote?.lastPrice != null ? ` ${realtimeQuote.lastPrice}` : ""}`
              : "等待即時"}
          </b>
        </div>
        <div>
          <span className="tg soft">主題</span>
          <b className="tg gold">{detail.themes.join(" / ") || "主題待接"}</b>
        </div>
      </div>

      <div className="company-detail-layout">
        <div className="company-main-column">
          <div className="company-workbench-shell">
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
        </div>

        <aside className="company-side-column">
          <CompanyInfoPanel company={company} />
          {/* ── 4 KGI/FinMind streaming panels ── */}
          <BidAskPanel symbol={company.ticker} />
          <LiveTickStreamPanel symbol={company.ticker} />
          <InstitutionalPanel companyId={company.id} />
          <MarginShortPanel companyId={company.id} />
          <SourceStatusCard sources={sources} />
        </aside>
      </div>

      {detail.themes.length > 0 && (
        <div className="panel hud-frame" style={{ marginBottom: 0, padding: "16px clamp(16px,2vw,26px) 20px" }}>
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

      <div className="company-tabs-band company-data-dock-title">
        <div>
          <span className="tg gold">公司資料艙</span>
          <strong>FinMind 與正式資料流</strong>
          <small>財報、籌碼、公告與盤中資料各自揭露來源狀態；沒有資料就顯示無資料或暫停，不補假內容。</small>
        </div>
        <div className="company-data-dock-tags">
          <span>價格</span>
          <span>財報</span>
          <span>籌碼</span>
          <span>公告</span>
          <span>逐筆</span>
        </div>
      </div>

      <div className="company-data-dock">
        <FinancialsPanel companyId={company.id} />
        <div className="company-data-side-rail">
          <ChipsPanel companyId={company.id} />
          <AnnouncementsPanel companyId={company.id} />
        </div>
        <div className="company-data-status-rail">
          <DerivativesPanel />
          <TickStreamPanel />
        </div>
      </div>

      {/* BLOCK #8 Lane C — sections [06]-[11] off /full-profile (PR #259) + DEGRADED announcements */}
      <div className="company-tabs-band company-data-dock-title">
        <div>
          <span className="tg gold">完整資料區</span>
          <strong>FinMind 11 資料集（[06]–[11]）</strong>
          <small>財報、月營收、法人籌碼、融資融券、股利政策、重大訊息；任何資料源 STALE / EMPTY / BLOCKED / DEGRADED 均誠實揭露，不補假。</small>
        </div>
        <div className="company-data-dock-tags">
          <span>財報</span>
          <span>月營收</span>
          <span>法人</span>
          <span>融資券</span>
          <span>股利</span>
          <span>公告</span>
        </div>
      </div>

      <FullProfilePanels companyId={company.id} />

      {/* ── 深度研究 section — My-TW-Coverage 知識圖譜 + 上下游圖譜 ── */}
      <div className="company-tabs-band company-data-dock-title">
        <div>
          <span className="tg gold">深度研究</span>
          <strong>My-TW-Coverage 知識圖譜</strong>
          <small>業務簡介、供應鏈位置、主要客戶與供應商、主題雷達；1735 檔 MIT 授權研究資料。</small>
        </div>
        <div className="company-data-dock-tags">
          <span>業務</span>
          <span>供應鏈</span>
          <span>客戶</span>
          <span>圖譜</span>
          <span>主題</span>
        </div>
      </div>
      <div className="company-knowledge-grid">
        <CoverageKnowledgePanel ticker={company.ticker} />
        <IndustryGraphPanel
          ticker={company.ticker}
          companyName={company.name}
        />
      </div>
    </PageFrame>
  );
}
