/**
 * /companies/[symbol] — Company Detail Page (D1 rewrite 2026-04-30)
 *
 * Server Component. Fetches from live backend using contracts-shape fields.
 * Chart is a Client Component (OhlcvCandlestickChart) receiving pre-fetched bars.
 *
 * Backend dependency:
 *   - GET /api/v1/companies → list-scan for ticker→UUID resolution
 *     (Jason TASK 1 will add ticker-aware :id route; until merged, we scan the list)
 *   - GET /api/v1/companies/:id/ohlcv?interval=1d → OHLCV bars (mock fallback on backend)
 *
 * Contracts fields rendered:
 *   ticker, name, market, country, chainPosition, beneficiaryTier,
 *   exposure (volume/asp/margin/capacity/narrative), validation (capitalFlow/consensus/relativeStrength),
 *   notes, themeIds
 *
 * RADAR-only fields dropped:
 *   score, momentum, intradayChgPct, fiiNetBn5d, marketCapBn, themes[] (string codes)
 *   Radar SVG removed.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";
import { getCompanyByTicker, getCompanyOhlcv, getThemes } from "@/lib/api";
import type { OhlcvBar } from "@/lib/api";
import type { Company, Theme } from "@iuf-trading-room/contracts";
import { OhlcvCandlestickChart } from "./OhlcvCandlestickChart";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tierBadgeClass(tier: Company["beneficiaryTier"]) {
  if (tier === "Core") return "badge-green";
  if (tier === "Direct") return "badge-green";
  if (tier === "Indirect") return "badge-yellow";
  return "badge"; // Observation
}

function scoreBar(value: number) {
  // 1–5 scale → 5 filled blocks
  return Array.from({ length: 5 }, (_, i) => (
    <span
      key={i}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        marginRight: 2,
        background: i < value ? "var(--gold)" : "var(--night-rule-strong)",
        borderRadius: 2,
      }}
    />
  ));
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const ticker = symbol.toUpperCase();

  // Resolve ticker → Company via list-scan (safe before Jason TASK 1 merges)
  const companyResult = await getCompanyByTicker(ticker);
  if (!companyResult) notFound();

  const company = companyResult.data;

  // Fetch OHLCV (fail-open: empty bars renders "NO DATA" badge)
  let bars: OhlcvBar[] = [];
  try {
    const { data: ohlcvData } = await getCompanyOhlcv(company.id, {
      interval: "1d",
    });
    bars = ohlcvData;
  } catch (_err) {
    // OHLCV failure is non-fatal — chart will show empty state
    bars = [];
  }

  // Fetch themes to resolve themeIds → names
  let themes: Theme[] = [];
  try {
    const { data: themeData } = await getThemes();
    themes = themeData;
  } catch (_err) {
    themes = [];
  }

  const companyThemes = themes.filter((t) => company.themeIds.includes(t.id));

  return (
    <PageFrame
      code={`03-${company.ticker}`}
      title={company.ticker}
      sub={`${company.name} · ${company.market} · ${company.country}`}
      note={`[03B] COMPANIES / ${company.ticker} — D1 contracts shape — OHLCV via GET /api/v1/companies/:id/ohlcv`}
    >
      {/* [01] COMPANY HEADER */}
      <section className="panel hud-frame">
        <div className="panel-head">
          <div>
            <span className="tg panel-code">CDL-01</span>
            <span className="tg muted"> · </span>
            <span className="tg gold">COMPANY HEADER</span>
            <div className="panel-sub">{company.chainPosition}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={tierBadgeClass(company.beneficiaryTier)}>
              {company.beneficiaryTier.toUpperCase()}
            </span>
            <span className="badge">{company.market}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, padding: "16px 0 8px", flexWrap: "wrap" }}>
          <div>
            <div className="eyebrow">TICKER</div>
            <div className="mono" style={{ fontWeight: 700, fontSize: 28, color: "var(--gold)" }}>
              {company.ticker}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">NAME</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--night-ink)" }}>
              {company.name}
            </div>
          </div>
          <div>
            <div className="eyebrow">COUNTRY</div>
            <div className="mono">{company.country}</div>
          </div>
        </div>

        {companyThemes.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingBottom: 12 }}>
            {companyThemes.map((t) => (
              <span key={t.id} className="session-pill tg">{t.name}</span>
            ))}
          </div>
        )}
      </section>

      {/* [02] OHLCV CHART */}
      <section className="panel hud-frame">
        <div className="panel-head">
          <div>
            <span className="tg panel-code">CDL-02</span>
            <span className="tg muted"> · </span>
            <span className="tg gold">K-LINE · 日線</span>
            <div className="panel-sub">
              GET /api/v1/companies/{company.id.slice(0, 8)}…/ohlcv?interval=1d
            </div>
          </div>
        </div>
        <div style={{ padding: "8px 0 4px" }}>
          <OhlcvCandlestickChart bars={bars} />
        </div>
      </section>

      {/* [03] EXPOSURE + VALIDATION */}
      <section className="panel hud-frame">
        <div className="panel-head">
          <span className="tg panel-code">CDL-03</span>
          <span className="tg muted"> · </span>
          <span className="tg gold">EXPOSURE / VALIDATION</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: "12px 0" }}>
          {/* Exposure breakdown */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>EXPOSURE BREAKDOWN</div>
            {(
              [
                ["VOLUME", company.exposure.volume],
                ["ASP", company.exposure.asp],
                ["MARGIN", company.exposure.margin],
                ["CAPACITY", company.exposure.capacity],
                ["NARRATIVE", company.exposure.narrative],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                  fontSize: 12,
                }}
              >
                <span className="eyebrow" style={{ width: 80, flexShrink: 0 }}>{label}</span>
                <span>{scoreBar(value)}</span>
                <span className="dim" style={{ fontSize: 11 }}>{value}/5</span>
              </div>
            ))}
          </div>

          {/* Validation snapshot */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>VALIDATION SNAPSHOT</div>
            {(
              [
                ["CAPITAL FLOW", company.validation.capitalFlow],
                ["CONSENSUS", company.validation.consensus],
                ["REL STRENGTH", company.validation.relativeStrength],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div
                key={label}
                style={{ marginBottom: 10, borderBottom: "1px solid var(--night-rule)", paddingBottom: 8 }}
              >
                <div className="eyebrow">{label}</div>
                <div style={{ fontSize: 13, color: "var(--night-ink)", marginTop: 4, lineHeight: 1.4 }}>
                  {value || <span className="dim">—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* [04] NOTES */}
      {company.notes && (
        <section className="panel hud-frame">
          <div className="panel-head">
            <span className="tg panel-code">CDL-04</span>
            <span className="tg muted"> · </span>
            <span className="tg gold">ANALYST NOTES</span>
          </div>
          <div style={{ padding: "12px 0 8px", lineHeight: 1.7, fontSize: 13, color: "var(--night-ink)" }}>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
              {company.notes}
            </pre>
          </div>
        </section>
      )}

      {/* [05] BACK NAV */}
      <div style={{ paddingTop: 12 }}>
        <Link className="btn-sm" href="/companies">
          &larr; COMPANIES LIST
        </Link>
      </div>
    </PageFrame>
  );
}
