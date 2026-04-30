import { notFound } from "next/navigation";
import { Chart } from "@/components/Chart";
import { PageFrame, Panel } from "@/components/PageFrame";
import type { ChartInterval } from "@/lib/radar-types";
import { api } from "@/lib/radar-api";
import {
  buildCompanyDetailMocks,
  toCompanyDetailQuote,
  toCompanyDetailView,
} from "@/lib/company-adapter";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { ChipsPanel } from "./ChipsPanel";
import { CompanyHeroBar } from "./CompanyHeroBar";
import { CompanyInfoPanel } from "./CompanyInfoPanel";
import { DerivativesPanel } from "./DerivativesPanel";
import { FinancialsPanel } from "./FinancialsPanel";
import { PaperOrderPanel } from "./PaperOrderPanel";
import { SourceStatusCard } from "./SourceStatusCard";
import { TickStreamPanel } from "./TickStreamPanel";

const COMPANY_INTERVALS: ChartInterval[] = ["1d", "5d", "1mo", "3mo", "6mo", "1y"];

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

export async function generateStaticParams() {
  const companies = await api.companies();
  return companies.map((company) => ({ symbol: company.symbol }));
}

export default async function CompanyPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const [companyRaw, quotes] = await Promise.all([
    api.company(symbol),
    api.quotes(),
  ]);
  if (!companyRaw) notFound();

  const company = toCompanyDetailView(companyRaw, symbol);
  const quote = toCompanyDetailQuote(quotes.find((item) => item.symbol === company.symbol), company);
  const mocks = buildCompanyDetailMocks(company);
  const latestPrice = quote.last ?? Math.max(1, Math.round((company.marketCapBn ?? 100) / 15));

  return (
    <PageFrame
      code={`03-${company.symbol}`}
      title={company.symbol}
      sub={`${company.name} - ${company.market}`}
      note="[03B] 公司詳情頁 RADAR 9-panel visual skeleton - mock props only - no paper order routing"
    >
      <CompanyHeroBar company={company} quote={quote} />

      <div className="company-detail-layout">
        <div className="company-main-column">
          <Panel
            code="PX-OHLCV"
            title="OHLCV K 線"
            sub="同一套 RADAR Lightweight Chart，資料源 badge 先以 MOCK 佔位"
            right={<span className="badge badge-blue">MOCK</span>}
          >
            <div className="company-chart-wrap">
              <Chart
                symbol={company.symbol}
                interval="1d"
                intervalOptions={COMPANY_INTERVALS}
                sourceLabel="MOCK"
                height={420}
              />
            </div>
          </Panel>

          <CompanyInfoPanel company={company} />
        </div>

        <aside className="company-side-column">
          <PaperOrderPanel symbol={company.symbol} latestPrice={latestPrice} />
          <SourceStatusCard sources={mocks.sources} />
        </aside>
      </div>

      <div className="company-kpi-strip">
        <div>
          <span className="tg soft">SCORE</span>
          <b className="num">{company.scorePct}</b>
        </div>
        <div>
          <span className="tg soft">MOM</span>
          <b className={`tg ${tone(company.intradayChgPct)}`}>{company.momentum}</b>
        </div>
        <div>
          <span className="tg soft">FII 5D</span>
          <b className={`num ${tone(company.fiiNetBn5d)}`}>{signed(company.fiiNetBn5d)} BN</b>
        </div>
        <div>
          <span className="tg soft">INTRADAY</span>
          <b className={`num ${tone(company.intradayChgPct)}`}>{signed(company.intradayChgPct)}%</b>
        </div>
        <div>
          <span className="tg soft">THEMES</span>
          <b className="tg gold">{company.themes.join(" / ")}</b>
        </div>
      </div>

      <div className="company-tabs-band">
        <span className="tg gold">COMPANY SURFACE</span>
        <span className="tg soft">財報 / 籌碼 / 公告 / 期權 / tick stream</span>
      </div>

      <div className="company-panels-grid">
        <FinancialsPanel
          symbol={company.symbol}
          quarterly={mocks.financials.quarterly}
          yearly={mocks.financials.yearly}
          revenue={mocks.financials.revenue}
          dividend={mocks.financials.dividend}
        />
        <ChipsPanel rows={mocks.chips} />
        <AnnouncementsPanel rows={mocks.announcements} />
        <DerivativesPanel rows={mocks.derivatives} />
        <TickStreamPanel rows={mocks.ticks} />
      </div>
    </PageFrame>
  );
}

