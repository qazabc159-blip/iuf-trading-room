"use client";
/**
 * 04 · IDEAS — KPI + filters + idea cards (with 帶去下單台 CTA).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Idea } from "@/lib/radar-types";
import { SectHead } from "@/components/PageFrame";
import {
  KpiStrip, FilterBar, Seg, Sort, TextInput, MultiChip, Toggle,
  QualityBadge, SideBadge, ThemeChip,
} from "@/components/research";
import { SendToTicketButton } from "@/components/SendToTicketButton";

type QFil = "ALL" | "HIGH" | "MED" | "LOW";
type SFil = "ALL" | "LONG" | "SHORT" | "TRIM" | "EXIT";
type SortKey = "emittedAt" | "confidence" | "score";

export function IdeasPageClient({ ideas }: { ideas: Idea[] }) {
  const [q, setQ] = useState("");
  const [quality, setQuality] = useState<QFil>("ALL");
  const [side, setSide] = useState<SFil>("ALL");
  const [themes, setThemes] = useState<string[]>([]);
  const [activeOnly, setActiveOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("emittedAt");

  const allThemes = useMemo(() => [...new Set(ideas.map(i => i.themeCode))].sort(), [ideas]);
  const now = Date.now();

  const kpi = useMemo(() => {
    const total = ideas.length;
    const c = (k: Idea["quality"]) => ideas.filter(i => i.quality === k).length;
    const s = (k: Idea["side"])    => ideas.filter(i => i.side === k).length;
    const avgConf = ideas.reduce((a, i) => a + i.confidence, 0) / Math.max(1, total);
    const avgSco  = ideas.reduce((a, i) => a + i.score, 0) / Math.max(1, total);
    return { total, hi: c("HIGH"), me: c("MED"), lo: c("LOW"),
             lg: s("LONG"), sh: s("SHORT"), tr: s("TRIM"), ex: s("EXIT"),
             avgConf, avgSco };
  }, [ideas]);

  const rows = useMemo(() => {
    let r = ideas.slice();
    if (q) r = r.filter(i => i.symbol.toLowerCase().includes(q.toLowerCase()));
    if (quality !== "ALL") r = r.filter(i => i.quality === quality);
    if (side !== "ALL")    r = r.filter(i => i.side === side);
    if (themes.length)     r = r.filter(i => themes.includes(i.themeCode));
    if (activeOnly)        r = r.filter(i => new Date(i.expiresAt).getTime() > now);
    const cmp: Record<SortKey, (a: Idea, b: Idea) => number> = {
      emittedAt:  (a, b) => +new Date(b.emittedAt) - +new Date(a.emittedAt),
      confidence: (a, b) => b.confidence - a.confidence,
      score:      (a, b) => b.score - a.score,
    };
    r.sort(cmp[sort]);
    return r;
  }, [ideas, q, quality, side, themes, activeOnly, sort, now]);

  return (
    <>
      <SectHead code="§ A · SUMMARY · KPI" sub="意見池快照" right={`共 ${kpi.total} ideas`} />
      <KpiStrip cells={[
        { label: "TOTAL", value: kpi.total },
        { label: "HIGH",  value: kpi.hi, tone: "gold" },
        { label: "MED",   value: kpi.me },
        { label: "LOW",   value: kpi.lo },
        { label: "LONG",  value: kpi.lg },
        { label: "SHORT", value: kpi.sh },
        { label: "TRIM",  value: kpi.tr },
        { label: "EXIT",  value: kpi.ex },
        { label: "AVG · CONF",  value: kpi.avgConf.toFixed(2), format: "serif" },
        { label: "AVG · SCORE", value: kpi.avgSco.toFixed(2),  format: "serif" },
      ]} />

      <SectHead code="§ B · FILTER · BAR" sub="過濾 / 排序" />
      <FilterBar right={<span className="tg" style={{ color: "var(--night-soft)" }}>{rows.length} / {kpi.total}</span>}>
        <TextInput label="Q" value={q} onChange={setQ} placeholder="symbol" />
        <Seg label="QUAL" value={quality} options={["ALL","HIGH","MED","LOW"] as const} onChange={setQuality} />
        <Seg label="SIDE" value={side} options={["ALL","LONG","SHORT","TRIM","EXIT"] as const} onChange={setSide} />
        <Sort value={sort} options={[
          { key: "emittedAt",  label: "emittedAt ↓" },
          { key: "confidence", label: "conf ↓" },
          { key: "score",      label: "score ↓" },
        ] as const} onChange={setSort} />
        <Toggle label="ACTIVE ONLY" value={activeOnly} onChange={setActiveOnly} />
      </FilterBar>
      <div style={{ marginBottom: 14 }}>
        <MultiChip label="THEMES" options={allThemes} value={themes} onChange={setThemes} />
      </div>

      <SectHead code="§ C · IDEA · CARDS" sub={`${rows.length} 張卡 · 點「↘ 帶去下單台」帶 IdeaHandoff`} />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 0,
        border: "1px solid var(--night-rule-strong)", borderBottom: "none",
      }}>
        {rows.map((i, idx) => {
          const expIn = +new Date(i.expiresAt) - now;
          const expHrs = Math.max(0, Math.round(expIn / 3600000));
          const hi = i.quality === "HIGH";
          return (
            <div key={i.id} style={{
              padding: "16px 18px",
              borderRight:  (idx % 2) === 0 ? "1px solid var(--night-rule)" : "none",
              borderBottom: "1px solid var(--night-rule-strong)",
              borderLeft: hi ? "3px solid var(--gold)" : "3px solid transparent",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <Link href={`/companies/${i.symbol}`} style={{
                  fontFamily: "var(--mono)", fontWeight: 700, fontSize: 14,
                  color: "var(--gold)", textDecoration: "none",
                }}>{i.symbol}</Link>
                <SideBadge s={i.side} />
                <QualityBadge q={i.quality} />
                <span className="tg" style={{ color: "var(--night-soft)", marginLeft: "auto" }}>{i.id}</span>
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8, marginTop: 10, marginBottom: 8,
                borderTop: "1px solid var(--night-rule)", paddingTop: 8,
              }}>
                {[
                  { l: "CONF",   v: i.confidence.toFixed(2) },
                  { l: "SCORE",  v: i.score.toFixed(2) },
                  { l: "EXP",    v: expHrs > 24 ? `${Math.round(expHrs/24)}d` : `${expHrs}h` },
                ].map(c => (
                  <div key={c.l}>
                    <div className="tg" style={{ color: "var(--night-mid)" }}>{c.l}</div>
                    <div style={{
                      fontFamily: "var(--serif-en)", fontSize: 22,
                      fontStyle: "italic", fontWeight: 300, lineHeight: 1.1,
                      color: "var(--night-ink)",
                    }}>{c.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 8 }}>
                <ThemeChip code={i.themeCode} />
                <span className="tg" style={{ color: "var(--night-mid)", marginLeft: 4 }}>
                  · {new Date(i.emittedAt).toLocaleString("zh-TW", { hour12: false })}
                </span>
              </div>
              <div style={{
                fontFamily: "var(--serif-tc)", fontSize: 14, lineHeight: 1.55,
                color: "var(--night-mid)",
                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>{i.rationale}</div>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--night-rule)",
              }}>
                <span className="tg" style={{ color: "var(--night-soft)" }}>{i.runId}</span>
                <SendToTicketButton idea={i} />
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div style={{
            gridColumn: "1 / -1", padding: "30px 18px", textAlign: "center",
            borderBottom: "1px solid var(--night-rule-strong)",
            color: "var(--night-soft)", fontFamily: "var(--mono)", fontSize: 11,
          }}>查無符合條件的 ideas</div>
        )}
      </div>
    </>
  );
}
