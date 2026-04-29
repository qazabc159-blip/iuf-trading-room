"use client";
/**
 * 03 · COMPANIES — KPI + multi-filter + dense table.
 *
 * §A KPI strip · §B FilterBar · §C Table
 * Research-layer: NO red/green tints on Δ% / FII; sign + weight only.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Company } from "@/lib/radar-types";
import { SectHead } from "@/components/PageFrame";
import {
  KpiStrip, FilterBar, Seg, Sort, TextInput, MultiChip,
  MomentumBadge, ThemeChip,
} from "@/components/research";

type Listing = "ALL" | "TWSE" | "TPEX";
type MomFil  = "ALL" | "ACCEL" | "STEADY" | "DECEL";
type SortKey = "score" | "marketCap" | "intradayChgPct" | "fiiNetBn5d" | "symbol";

export function CompaniesPageClient({ companies }: { companies: Company[] }) {
  const [q, setQ]           = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [listing, setListing] = useState<Listing>("ALL");
  const [mom, setMom]       = useState<MomFil>("ALL");
  const [sort, setSort]     = useState<SortKey>("score");

  const allThemes = useMemo(() => {
    const s = new Set<string>();
    companies.forEach(c => c.themes.forEach(t => s.add(t)));
    return [...s].sort();
  }, [companies]);

  /* KPI ───────────────────────────────────────────────── */
  const kpi = useMemo(() => {
    const total = companies.length;
    const twse  = companies.filter(c => c.listing === "TWSE").length;
    const tpex  = companies.filter(c => c.listing === "TPEX").length;
    const avgScore = companies.reduce((s, c) => s + c.score, 0) / Math.max(1, total);
    const up   = companies.filter(c => c.intradayChgPct > 0).length;
    const dn   = companies.filter(c => c.intradayChgPct < 0).length;
    const fiiIn  = companies.filter(c => c.fiiNetBn5d > 0).reduce((s, c) => s + c.fiiNetBn5d, 0);
    const fiiOut = companies.filter(c => c.fiiNetBn5d < 0).reduce((s, c) => s + c.fiiNetBn5d, 0);
    return { total, twse, tpex, avgScore, up, dn, fiiIn, fiiOut };
  }, [companies]);

  /* filter + sort ─────────────────────────────────────── */
  const rows = useMemo(() => {
    let r = companies.slice();
    if (q) {
      const k = q.toLowerCase();
      r = r.filter(c => c.symbol.toLowerCase().includes(k) || c.name.toLowerCase().includes(k));
    }
    if (themes.length) r = r.filter(c => themes.every(t => c.themes.includes(t)));
    if (listing !== "ALL") r = r.filter(c => c.listing === listing);
    if (mom !== "ALL")     r = r.filter(c => c.momentum === mom);
    const cmp: Record<SortKey, (a: Company, b: Company) => number> = {
      score:           (a, b) => b.score - a.score,
      marketCap:       (a, b) => b.marketCapBn - a.marketCapBn,
      intradayChgPct:  (a, b) => b.intradayChgPct - a.intradayChgPct,
      fiiNetBn5d:      (a, b) => b.fiiNetBn5d - a.fiiNetBn5d,
      symbol:          (a, b) => a.symbol.localeCompare(b.symbol),
    };
    r.sort(cmp[sort]);
    return r;
  }, [companies, q, themes, listing, mom, sort]);

  return (
    <>
      <SectHead code="§ A · SUMMARY · STATE" sub="公司池快照" right={`共 ${kpi.total} 檔`} />
      <KpiStrip cells={[
        { label: "TOTAL", value: kpi.total },
        { label: "TWSE",  value: kpi.twse },
        { label: "TPEX",  value: kpi.tpex },
        { label: "AVG · SCORE", value: kpi.avgScore.toFixed(2), format: "serif", tone: "gold" },
        { label: "Δ% · UP",   value: kpi.up },
        { label: "Δ% · DN",   value: kpi.dn },
        { label: "FII · IN",  value: `+${kpi.fiiIn.toFixed(1)}B` },
        { label: "FII · OUT", value: `${kpi.fiiOut.toFixed(1)}B` },
      ]} />

      <SectHead code="§ B · FILTER · BAR" sub="搜尋 / 主題 / 上市別 / 動能 / 排序" />
      <FilterBar right={<span className="tg" style={{ color: "var(--night-soft)" }}>{rows.length} / {kpi.total} 檔</span>}>
        <TextInput label="Q"  value={q} onChange={setQ} placeholder="symbol / name" />
        <Seg label="LIST" value={listing} options={["ALL","TWSE","TPEX"] as const} onChange={setListing} />
        <Seg label="MOM"  value={mom}     options={["ALL","ACCEL","STEADY","DECEL"] as const} onChange={setMom} />
        <Sort value={sort} options={[
          { key: "score", label: "score ↓" },
          { key: "marketCap", label: "cap ↓" },
          { key: "intradayChgPct", label: "Δ% ↓" },
          { key: "fiiNetBn5d", label: "FII ↓" },
          { key: "symbol", label: "symbol" },
        ] as const} onChange={setSort} />
      </FilterBar>
      <div style={{ marginBottom: 14 }}>
        <MultiChip label="THEMES" options={allThemes} value={themes} onChange={setThemes} />
      </div>

      <SectHead code="§ C · TABLE" sub="點 row 進個股" />
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--night-rule-strong)", color: "var(--night-mid)" }}>
            {["SYMBOL","NAME","LIST","CAP·BN","THEMES","SCORE","MOM","Δ%","FII·5D"].map(h => (
              <th key={h} className="tg" style={{ textAlign: "left", padding: "8px 6px", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.symbol} style={{ borderBottom: "1px solid var(--night-rule)" }}>
              <td className="tg" style={{ padding: "10px 6px", color: "var(--gold)" }}>
                <Link href={`/companies/${c.symbol}`} style={{ color: "var(--gold)" }}>{c.symbol}</Link>
              </td>
              <td style={{ padding: "10px 6px", fontFamily: "var(--serif-tc)", fontSize: 15 }}>
                <Link href={`/companies/${c.symbol}`} style={{ color: "var(--night-ink)" }}>{c.name}</Link>
              </td>
              <td className="tg" style={{ padding: "10px 6px", color: "var(--night-mid)" }}>{c.listing}</td>
              <td className="tg" style={{ padding: "10px 6px", color: "var(--night-mid)", fontFeatureSettings: '"tnum","lnum"' }}>{c.marketCapBn.toFixed(0)}</td>
              <td style={{ padding: "10px 6px" }}>{c.themes.map(t => <ThemeChip key={t} code={t} />)}</td>
              <td style={{
                padding: "10px 6px", fontFamily: "var(--serif-en)", fontSize: 18,
                fontStyle: "italic", fontWeight: 300, color: "var(--night-ink)",
              }}>{c.score.toFixed(2)}</td>
              <td style={{ padding: "10px 6px" }}><MomentumBadge m={c.momentum} /></td>
              <td className="tg" style={{
                padding: "10px 6px", fontFeatureSettings: '"tnum","lnum"',
                fontWeight: c.intradayChgPct > 0 ? 700 : 500,
                color: "var(--night-ink)",
              }}>{c.intradayChgPct >= 0 ? "+" : ""}{c.intradayChgPct.toFixed(2)}%</td>
              <td className="tg" style={{
                padding: "10px 6px", fontFeatureSettings: '"tnum","lnum"',
                fontWeight: c.fiiNetBn5d > 0 ? 700 : 500,
                color: "var(--night-ink)",
              }}>{c.fiiNetBn5d >= 0 ? "+" : ""}{c.fiiNetBn5d.toFixed(2)}B</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={9} style={{
              padding: "26px 6px", textAlign: "center",
              color: "var(--night-soft)", fontFamily: "var(--mono)", fontSize: 11,
            }}>查無符合條件的公司 · 調整篩選</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
