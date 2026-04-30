// /companies/[symbol]/page.tsx — Server Component
// 9-panel company surface on top of live contracts-shape Company + OHLCV.
// HeroBar / OHLCV chart / CompanyInfo / Chips / Announcements / Financials bind
// to /api/v1. Panels without a production contract render BLOCKED, not mock data.
//
// HARD LINE: never import KGI SDK or call broker live submit path.

import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { getCompanies, getCompanyOhlcv, type OhlcvBar } from "@/lib/api";
import type { Company } from "@iuf-trading-room/contracts";
import {
  quoteFromOhlcvBars,
  type SourceStatus,
  toCompanyDetailView,
} from "@/lib/company-adapter";

import { CompanyHeroBar }      from "./CompanyHeroBar";
import { CompanyInfoPanel }    from "./CompanyInfoPanel";
import { OhlcvCandlestickChart } from "./OhlcvCandlestickChart";
import { FinancialsPanel }     from "./FinancialsPanel";
import { ChipsPanel }          from "./ChipsPanel";
import { AnnouncementsPanel }  from "./AnnouncementsPanel";
import { PaperOrderPanel }     from "./PaperOrderPanel";
import { SourceStatusCard }    from "./SourceStatusCard";
import { DerivativesPanel }    from "./DerivativesPanel";
import { TickStreamPanel }     from "./TickStreamPanel";

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function companyTimestamp(company: Company) {
  const record = company as unknown as { updatedAt?: string; createdAt?: string };
  return record.updatedAt ?? record.createdAt ?? new Date().toISOString();
}

function buildSourceStatus(company: Company, bars: OhlcvBar[]): SourceStatus[] {
  const lastBar = bars.at(-1);
  const lastBarTime = lastBar ? new Date(`${lastBar.dt}T13:30:00+08:00`).toISOString() : new Date().toISOString();
  const priceSource = lastBar?.source === "tej" ? "FinMind/TEJ official OHLCV" : lastBar?.source === "kgi" ? "KGI readonly quote" : null;

  return [
    {
      id: "company-master",
      label: "Company master",
      state: "live",
      summary: "Workspace company record",
      lastSeen: companyTimestamp(company),
      detail: "GET /api/v1/companies returned this symbol in the authenticated workspace.",
      queueDepth: 0,
    },
    {
      id: "ohlcv",
      label: "Daily OHLCV",
      state: lastBar && priceSource ? "live" : "error",
      summary: priceSource ?? "No production bars returned",
      lastSeen: lastBarTime,
      detail: lastBar
        ? `GET /api/v1/companies/:id/ohlcv returned ${bars.length} bars; latest source=${lastBar.source}.`
        : "GET /api/v1/companies/:id/ohlcv returned zero bars, so price-derived UI stays empty.",
      queueDepth: 0,
    },
    {
      id: "twse-announcements",
      label: "Market Intel",
      state: "live",
      summary: "TWSE OpenAPI material announcements",
      lastSeen: new Date().toISOString(),
      detail: "GET /api/v1/companies/:id/announcements?days=30 is bound in panel [05].",
      queueDepth: 0,
    },
    {
      id: "kgi-ticks",
      label: "Tick stream",
      state: "error",
      summary: "Blocked until KGI readonly tick contract is confirmed",
      lastSeen: new Date().toISOString(),
      detail: "Panel [09] is intentionally BLOCKED and does not render generated tick rows.",
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
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "(unset)";
  const wsSlug  = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

  let companies: Company[] = [];
  let fetchErrorMsg: string | null = null;
  try {
    const res = await getCompanies();
    companies = res.data ?? [];
  } catch (err) {
    fetchErrorMsg = err instanceof Error ? err.message : String(err);
    console.error("[company-detail] getCompanies failed", { symbol, err: fetchErrorMsg });
  }

  if (fetchErrorMsg !== null) {
    return (
      <PageFrame
        code="03-ERR"
        title={symbol.toUpperCase()}
        sub="fetch /api/v1/companies failed"
        note={`[03B-DIAG] /companies/${symbol} · 後端 list 取不回`}
      >
        <div style={{ padding: "32px 24px", fontFamily: "var(--mono, monospace)", fontSize: 12, lineHeight: 1.7 }}>
          <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 16, fontSize: 14 }}>
            [DIAG] /companies/{symbol.toUpperCase()} — getCompanies() failed
          </div>
          <div className="dim" style={{ marginBottom: 8 }}>API_BASE: <b>{apiBase}</b></div>
          <div className="dim" style={{ marginBottom: 8 }}>WORKSPACE_SLUG: <b>{wsSlug}</b></div>
          <div className="dim" style={{ marginBottom: 8 }}>PATH: <b>/api/v1/companies</b></div>
          <div className="dim" style={{ marginBottom: 16 }}>
            ERROR (raw): <pre style={{ background: "rgba(255,0,0,0.08)", padding: 12, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-all", maxWidth: 800 }}>{fetchErrorMsg}</pre>
          </div>
          <div className="dim" style={{ marginBottom: 16 }}>
            可能原因：(a) SSR cookie 未轉發 → 401；(b) workspace_slug 不對 → 401/403；(c) API base 設錯；(d) 後端 5xx。把 ERROR 那段截圖貼給 Elva。
          </div>
          <Link href="/companies" className="btn-sm">← 公司列表</Link>
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
        code="03-?"
        title={symbol.toUpperCase()}
        sub="ticker not found"
        note={`[03B] /companies/${symbol} · ticker 不在 workspace 公司清單中`}
      >
        <div style={{ padding: "32px 24px", fontFamily: "var(--mono, monospace)", fontSize: 12 }}>
          <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 12 }}>
            [NOT FOUND] {symbol.toUpperCase()}
          </div>
          <div className="dim" style={{ marginBottom: 16 }}>
            workspace 共 {companies.length} 家公司，沒有 ticker = <b>{symbol}</b> 的紀錄。
          </div>
          {companies.length > 0 && (
            <div className="dim" style={{ marginBottom: 16 }}>
              SAMPLE: {companies.slice(0, 8).map((c) => c.ticker).join(" / ")}
            </div>
          )}
          <Link href="/companies" className="btn-sm">← 公司列表</Link>
        </div>
      </PageFrame>
    );
  }

  const bars: OhlcvBar[] = await getCompanyOhlcv(company.id, { interval: "1d" }).catch((err) => {
    console.warn("[company-detail] getCompanyOhlcv failed", { id: company.id, err });
    return [];
  });

  const detail = toCompanyDetailView(company, symbol);
  const quote = quoteFromOhlcvBars(bars, detail);
  const sources = buildSourceStatus(company, bars);

  return (
    <PageFrame
      code={`03-${company.ticker}`}
      title={company.ticker}
      sub={`${company.name} · ${company.market}`}
      note={`[03B] COMPANIES / ${company.ticker} · ${company.chainPosition} · ${company.beneficiaryTier}`}
    >
      <div style={{ marginBottom: 8 }}>
        <Link
          href="/companies"
          className="btn-sm"
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 11 }}
        >
          ← 公司列表
        </Link>
      </div>

      <CompanyHeroBar company={detail} quote={quote} />

      <div className="company-detail-layout">
        <div className="company-main-column">
          <OhlcvCandlestickChart bars={bars} symbol={company.ticker} />
          <CompanyInfoPanel company={company} />
        </div>

        <aside className="company-side-column">
          <PaperOrderPanel symbol={company.ticker} />
          <SourceStatusCard sources={sources} />
        </aside>
      </div>

      <div className="company-kpi-strip">
        <div>
          <span className="tg soft">SCORE</span>
          <b className="num">{detail.scorePct}</b>
        </div>
        <div>
          <span className="tg soft">MOM</span>
          <b className={`tg ${tone(detail.intradayChgPct)}`}>{detail.momentum}</b>
        </div>
        <div>
          <span className="tg soft">FII 5D</span>
          <b className={`num ${tone(detail.fiiNetBn5d)}`}>{signed(detail.fiiNetBn5d)} BN</b>
        </div>
        <div>
          <span className="tg soft">INTRADAY</span>
          <b className={`num ${tone(detail.intradayChgPct)}`}>{signed(detail.intradayChgPct)}%</b>
        </div>
        <div>
          <span className="tg soft">THEMES</span>
          <b className="tg gold">{detail.themes.join(" / ") || "—"}</b>
        </div>
      </div>

      <div className="company-tabs-band">
        <span className="tg gold">COMPANY SURFACE</span>
        <span className="tg soft">財報 / 籌碼 / 公告 / 期權 / tick stream</span>
      </div>

      <div className="company-panels-grid">
        <FinancialsPanel companyId={company.id} />
        <ChipsPanel companyId={company.id} />
        <AnnouncementsPanel companyId={company.id} />
        <DerivativesPanel />
        <TickStreamPanel />
      </div>
    </PageFrame>
  );
}
