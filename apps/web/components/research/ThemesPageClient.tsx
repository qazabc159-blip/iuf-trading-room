"use client";
/**
 * 02 · THEMES — dual-view ladder (火力 cards / 清單 dense table).
 *
 * Sections:
 *   §A · SUMMARY · STATE  — KPI strip
 *   §B · CONTROLS         — view toggle + sort + lockState/momentum filters
 *   §C-1 火力 / §C-2 清單  — 視 view 切換
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Theme } from "@/lib/radar-types";
import { SectHead } from "@/components/PageFrame";
import {
  KpiStrip, FilterBar, Seg, Sort,
  MomentumBadge, LockBadge,
} from "@/components/research";
import { Pulse } from "@/components/Pulse";

type View = "火力" | "清單";
type LockFilter = "ALL" | "LOCKED" | "TRACK" | "WATCH" | "STALE";
type MomFilter  = "ALL" | "ACCEL" | "STEADY" | "DECEL";
type SortKey    = "rank" | "heat" | "dHeat" | "members" | "momentum";

export function ThemesPageClient({ themes }: { themes: Theme[] }) {
  const [view, setView] = useState<View>("火力");
  const [lock, setLock] = useState<LockFilter>("ALL");
  const [mom, setMom]   = useState<MomFilter>("ALL");
  const [sort, setSort] = useState<SortKey>("rank");

  /* KPI ───────────────────────────────────────────────── */
  const kpi = useMemo(() => {
    const total = themes.length;
    const c = (s: Theme["lockState"]) => themes.filter(t => t.lockState === s).length;
    const avgHeat = themes.reduce((s, t) => s + t.heat, 0) / Math.max(1, total);
    const avgDh = themes.reduce((s, t) => s + t.dHeat, 0) / Math.max(1, total);
    return { total, lk: c("LOCKED"), tr: c("TRACK"), wa: c("WATCH"), st: c("STALE"), avgHeat, avgDh };
  }, [themes]);

  /* filter + sort ─────────────────────────────────────── */
  const rows = useMemo(() => {
    let r = themes.slice();
    if (lock !== "ALL") r = r.filter(t => t.lockState === lock);
    if (mom !== "ALL")  r = r.filter(t => t.momentum === mom);
    const cmp: Record<SortKey, (a: Theme, b: Theme) => number> = {
      rank:     (a, b) => a.rank - b.rank,
      heat:     (a, b) => b.heat - a.heat,
      dHeat:    (a, b) => b.dHeat - a.dHeat,
      members:  (a, b) => b.members - a.members,
      momentum: (a, b) => a.momentum.localeCompare(b.momentum),
    };
    r.sort(cmp[sort]);
    return r;
  }, [themes, lock, mom, sort]);

  return (
    <>
      <SectHead code="§ A · SUMMARY · STATE" sub="主題池快照" right={`共 ${kpi.total} 主題`} />
      <KpiStrip cells={[
        { label: "TOTAL",  value: kpi.total },
        { label: "LOCKED", value: kpi.lk, tone: "gold" },
        { label: "TRACK",  value: kpi.tr },
        { label: "WATCH",  value: kpi.wa },
        { label: "STALE",  value: kpi.st },
        { label: "AVG · HEAT", value: kpi.avgHeat.toFixed(1), format: "serif" },
        { label: "AVG · Δ7d",  value: (kpi.avgDh > 0 ? "+" : "") + kpi.avgDh.toFixed(1), format: "serif" },
      ]} />

      <SectHead code="§ B · CONTROLS" sub="檢視 / 排序 / 篩選" />
      <FilterBar right={<span className="tg" style={{ color: "var(--night-soft)" }}>{rows.length} / {themes.length}</span>}>
        <Seg label="VIEW" value={view} options={["火力","清單"] as const} onChange={setView} />
        <Sort value={sort} options={[
          { key: "rank", label: "rank ↑" },
          { key: "heat", label: "heat ↓" },
          { key: "dHeat", label: "Δ7d ↓" },
          { key: "members", label: "members ↓" },
          { key: "momentum", label: "momentum" },
        ] as const} onChange={setSort} />
        <Seg label="LOCK"  value={lock} options={["ALL","LOCKED","TRACK","WATCH","STALE"] as const} onChange={setLock} />
        <Seg label="MOM"   value={mom}  options={["ALL","ACCEL","STEADY","DECEL"] as const} onChange={setMom} />
      </FilterBar>

      {view === "火力" ? (
        <SectHead code="§ C-1 · FIRE · GRID" sub="火力檢視" />
      ) : (
        <SectHead code="§ C-2 · LEDGER · LIST" sub="清單檢視 · 密度更高" />
      )}

      {view === "火力" ? <FireGrid rows={rows} /> : <LedgerList rows={rows} />}
    </>
  );
}

/* ─── Card grid ─────────────────────────────────────────── */
function FireGrid({ rows }: { rows: Theme[] }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
      border: "1px solid var(--night-rule-strong)", borderBottom: "none",
    }}>
      {rows.map((t, i) => {
        const locked = t.lockState === "LOCKED";
        return (
          <Link key={t.code} href={`/themes/${t.short}`} style={{
            display: "block",
            padding: "14px 16px",
            borderRight:  (i % 3) !== 2 ? "1px solid var(--night-rule)" : "none",
            borderBottom: "1px solid var(--night-rule-strong)",
            borderLeft: locked ? "3px solid var(--gold)" : "3px solid transparent",
            color: "var(--night-ink)", textDecoration: "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="tg" style={{ color: "var(--gold)", fontWeight: 700 }}>
                {String(t.rank).padStart(2,"0")} · {t.code}
              </span>
              <span className="tg" style={{
                color: t.dHeat > 0 ? "var(--gold-bright)" : t.dHeat < 0 ? "var(--night-soft)" : "var(--night-mid)",
              }}>
                {t.dHeat > 0 ? "+" : ""}{t.dHeat}
              </span>
            </div>
            <div style={{
              fontFamily: "var(--serif-tc)", fontSize: 19,
              marginTop: 6, marginBottom: 8, lineHeight: 1.2,
            }}>{t.name}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <Pulse values={t.pulse} />
              <span style={{
                fontFamily: "var(--serif-en)", fontSize: 30, fontStyle: "italic", fontWeight: 300, lineHeight: 1,
              }}>{t.heat}</span>
            </div>
            <div style={{
              display: "flex", gap: 12, marginTop: 8,
              fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.16em",
              color: "var(--night-mid)",
            }}>
              <span>{t.members} 檔</span>
              <MomentumBadge m={t.momentum} />
              <LockBadge s={t.lockState} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ─── Dense list ────────────────────────────────────────── */
function LedgerList({ rows }: { rows: Theme[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--night-rule-strong)", color: "var(--night-mid)" }}>
          {["RANK","CODE","NAME","HEAT","Δ7","MEM","MOM","STATE","PULSE"].map(h => (
            <th key={h} className="tg" style={{ textAlign: "left", padding: "6px 6px", fontWeight: 500 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(t => (
          <tr key={t.code} style={{ borderBottom: "1px solid var(--night-rule)" }}>
            <td style={{ padding: "8px 6px", color: "var(--gold)", fontWeight: 700 }}>{String(t.rank).padStart(2,"0")}</td>
            <td style={{ padding: "8px 6px" }}>{t.code}</td>
            <td style={{ padding: "8px 6px", fontFamily: "var(--serif-tc)", fontSize: 14 }}>
              <Link href={`/themes/${t.short}`} style={{ color: "var(--night-ink)" }}>{t.name}</Link>
            </td>
            <td style={{ padding: "8px 6px", fontFamily: "var(--serif-en)", fontSize: 18, fontStyle: "italic", fontWeight: 300 }}>{t.heat}</td>
            <td style={{ padding: "8px 6px", color: t.dHeat > 0 ? "var(--gold-bright)" : "var(--night-mid)" }}>{t.dHeat > 0 ? "+" : ""}{t.dHeat}</td>
            <td style={{ padding: "8px 6px", color: "var(--night-mid)" }}>{t.members}</td>
            <td style={{ padding: "8px 6px" }}><MomentumBadge m={t.momentum} /></td>
            <td style={{ padding: "8px 6px" }}><LockBadge s={t.lockState} /></td>
            <td style={{ padding: "8px 6px" }}><Pulse values={t.pulse} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
