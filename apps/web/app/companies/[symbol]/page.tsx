// /companies/[symbol]/page.tsx — Server Component
// Reads contracts-shape Company + OHLCV from live backend.
// Panels: CompanyInfoPanel → OhlcvCandlestickChart → FinancialsPanel →
//         ChipsPanel → AnnouncementsPanel → PaperOrderPanel
//
// Each client panel is individually responsible for its own fetch + error state.
// OHLCV is pre-fetched server-side (fail-open: empty bars on error).

import { notFound } from "next/navigation";
import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { getCompanyByTicker, getCompanyOhlcv, type OhlcvBar } from "@/lib/api";

import { CompanyInfoPanel }    from "./CompanyInfoPanel";
import { OhlcvCandlestickChart } from "./OhlcvCandlestickChart";
import { FinancialsPanel }     from "./FinancialsPanel";
import { ChipsPanel }          from "./ChipsPanel";
import { AnnouncementsPanel }  from "./AnnouncementsPanel";
import { PaperOrderPanel }     from "./PaperOrderPanel";

// ── Tier badge helpers (shared across listing + detail) ───────────────────────
const tierBadge: Record<string, string> = {
  Core:        "badge-green",
  Direct:      "badge-yellow",
  Indirect:    "badge",
  Observation: "badge",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;

  // Resolve company by ticker (list-scan until Jason TASK1 lands ticker server-side lookup)
  const company = await getCompanyByTicker(symbol).catch(() => null);
  if (!company) notFound();

  // Pre-fetch OHLCV server-side (fail-open — chart shows NO DATA on empty)
  const bars: OhlcvBar[] = await getCompanyOhlcv(company.id, { interval: "1d" }).catch(() => []);

  return (
    <PageFrame
      code={`03-${company.ticker}`}
      title={company.ticker}
      sub={`${company.name} · ${company.market}`}
      note={`[03B] COMPANIES / ${company.ticker} · ${company.chainPosition} · ${company.beneficiaryTier}`}
    >
      {/* Back link */}
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/companies"
          className="btn-sm"
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 11 }}
        >
          ← 公司列表
        </Link>
      </div>

      {/* Stock page header row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 20,
        paddingBottom: 14,
        borderBottom: "1px solid var(--night-rule-strong, #333)",
        flexWrap: "wrap",
      }}>
        <span className="mono" style={{ fontWeight: 700, fontSize: 22, color: "var(--gold, #b8960c)" }}>
          {company.ticker}
        </span>
        <span style={{ fontSize: 16, color: "var(--night-ink, #d8d4c8)" }}>{company.name}</span>
        <span className={tierBadge[company.beneficiaryTier] ?? "badge"} style={{ fontSize: 11, padding: "2px 8px" }}>
          {company.beneficiaryTier}
        </span>
        <span className="badge" style={{ fontSize: 11, padding: "2px 8px" }}>{company.market}</span>
        <span className="badge" style={{ fontSize: 11, padding: "2px 8px" }}>{company.country}</span>
      </div>

      {/*
        Mobile responsive layout:
        - md:grid-cols-2 for InfoPanel + ChipsPanel side by side
        - Other panels full-width
      */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Row 1: InfoPanel + ChipsPanel (2-col on wider screens) */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 20,
        }}>
          {/* [01] Company Info */}
          <CompanyInfoPanel company={company} />

          {/* [04] Chips */}
          <ChipsPanel companyId={company.id} />
        </div>

        {/* [02] K-line chart — full width */}
        <OhlcvCandlestickChart bars={bars} symbol={company.ticker} />

        {/* [03] Financials — full width */}
        <FinancialsPanel companyId={company.id} />

        {/* [05] Announcements — full width */}
        <AnnouncementsPanel companyId={company.id} />

        {/* [06] Paper Order — full width */}
        <PaperOrderPanel symbol={company.ticker} />

      </div>
    </PageFrame>
  );
}
