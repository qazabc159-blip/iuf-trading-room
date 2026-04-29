import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";

export default async function CompaniesPage() {
  const companies = await api.companies();
  const up = companies.filter((company) => company.intradayChgPct > 0).length;
  const down = companies.filter((company) => company.intradayChgPct < 0).length;
  const fii = companies.reduce((sum, company) => sum + company.fiiNetBn5d, 0);
  const avgScore = companies.reduce((sum, company) => sum + company.score, 0) / companies.length;

  return (
    <PageFrame code="03" title="Companies" sub="公司板" note="[03] COMPANIES · radar registry · row opens dynamic symbol detail">
      <MetricStrip
        cells={[
          { label: "TOTAL", value: companies.length },
          { label: "TWSE", value: companies.filter((c) => c.listing === "TWSE").length },
          { label: "UP", value: up, tone: "up" },
          { label: "DOWN", value: down, tone: "down" },
          { label: "FII·NET", value: `${signed(fii, 2)}BN`, delta: fii },
          { label: "AVG·SCORE", value: avgScore.toFixed(2), tone: "gold" },
        ]}
        columns={6}
      />

      <Panel code="CO-REG" title="14:32:08 TPE · ● LIVE" sub="company registry · score / flow / theme links" right={`${companies.length} SYMBOLS`}>
        <div className="row position-row table-head tg" style={{ gridTemplateColumns: "60px minmax(100px,1fr) 74px 78px 78px 120px" }}>
          <span>SYM</span><span>名稱</span><span>SCORE</span><span>Δ%</span><span>FII·5D</span><span>THEMES</span>
        </div>
        {companies.map((company) => (
          <Link
            href={`/companies/${company.symbol}`}
            className="row position-row"
            style={{ gridTemplateColumns: "60px minmax(100px,1fr) 74px 78px 78px 120px" }}
            key={company.symbol}
          >
            <span className="tg gold">{company.symbol}</span>
            <span className="tc">{company.name}</span>
            <span className="num">{(company.score * 100).toFixed(0)}</span>
            <span className={`tg ${toneClass(company.intradayChgPct)}`}>{signed(company.intradayChgPct, 2)}%</span>
            <span className={`tg ${toneClass(company.fiiNetBn5d)}`}>{signed(company.fiiNetBn5d, 2)}BN</span>
            <span className="tg muted">{company.themes.join(" · ")}</span>
          </Link>
        ))}
      </Panel>
    </PageFrame>
  );
}
