// /companies/[symbol]/page.tsx — Server Component
// 9-panel RADAR visual skeleton on top of live contracts-shape Company + OHLCV.
// HeroBar / OHLCV chart / CompanyInfo / Chips / Announcements / Financials live
// from /api/v1; PaperOrder posts to /api/v1/paper/orders/*; Source / Derivatives /
// TickStream are visual placeholders fed by company-adapter mocks until backends land.
//
// HARD LINE: never import KGI SDK or call broker live submit path.

import { notFound } from "next/navigation";
import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { getCompanyByTicker, getCompanyOhlcv, type OhlcvBar } from "@/lib/api";
import {
  buildCompanyDetailMocks,
  quoteFromOhlcvBars,
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

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;

  const company = await getCompanyByTicker(symbol).catch(() => null);
  if (!company) notFound();

  const bars: OhlcvBar[] = await getCompanyOhlcv(company.id, { interval: "1d" }).catch(() => []);

  const detail = toCompanyDetailView(company, symbol);
  const quote = quoteFromOhlcvBars(bars, detail);
  const mocks = buildCompanyDetailMocks(detail);

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
          <SourceStatusCard sources={mocks.sources} />
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
        <DerivativesPanel rows={mocks.derivatives} />
        <TickStreamPanel rows={mocks.ticks} />
      </div>
    </PageFrame>
  );
}
