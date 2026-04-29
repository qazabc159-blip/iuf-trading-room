"use client";
/**
 * 05 · RUNS · LIST — KPI + filters + table.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Run } from "@/lib/radar-types";
import { SectHead } from "@/components/PageFrame";
import {
  KpiStrip, FilterBar, Seg, Sort, TextInput,
  fmtDuration, isoWeek,
} from "@/components/research";

type SrcFil   = "ALL" | "auto·post-close" | "auto·pre-open" | "manual";
type StateFil = "ALL" | "ACTIVE" | "ARCHIVED" | "FAILED";
type SortKey  = "startedAt" | "ideasEmitted" | "avgConfidence";

export function RunsPageClient({ runs }: { runs: Run[] }) {
  const [src,   setSrc]   = useState<SrcFil>("ALL");
  const [state, setState] = useState<StateFil>("ALL");
  const [week,  setWeek]  = useState("");
  const [ver,   setVer]   = useState("");
  const [sort,  setSort]  = useState<SortKey>("startedAt");

  const kpi = useMemo(() => {
    const total = runs.length;
    const c = (s: Run["state"]) => runs.filter(r => r.state === s).length;
    const avg = (k: keyof Pick<Run,"ideasEmitted"|"highQualityCount"|"avgConfidence"|"durationMs">) =>
      runs.reduce((sum, r) => sum + (r[k] as number), 0) / Math.max(1, total);
    return {
      total,
      ac: c("ACTIVE"), ar: c("ARCHIVED"), fl: c("FAILED"),
      ie: avg("ideasEmitted"),
      hq: avg("highQualityCount"),
      cf: avg("avgConfidence"),
      du: avg("durationMs"),
    };
  }, [runs]);

  const rows = useMemo(() => {
    let r = runs.slice();
    if (src !== "ALL")   r = r.filter(x => x.source === src);
    if (state !== "ALL") r = r.filter(x => x.state === state);
    if (week)            r = r.filter(x => isoWeek(x.startedAt).startsWith(week.trim()));
    if (ver)             r = r.filter(x => x.strategyVersion.includes(ver.trim()));
    const cmp: Record<SortKey, (a: Run, b: Run) => number> = {
      startedAt:     (a, b) => +new Date(b.startedAt) - +new Date(a.startedAt),
      ideasEmitted:  (a, b) => b.ideasEmitted - a.ideasEmitted,
      avgConfidence: (a, b) => b.avgConfidence - a.avgConfidence,
    };
    r.sort(cmp[sort]);
    return r;
  }, [runs, src, state, week, ver, sort]);

  return (
    <>
      <SectHead code="§ A · SUMMARY" sub="跑批快照" right={`共 ${kpi.total} runs`} />
      <KpiStrip cells={[
        { label: "TOTAL",    value: kpi.total },
        { label: "ACTIVE",   value: kpi.ac, tone: "gold" },
        { label: "ARCHIVED", value: kpi.ar },
        { label: "FAILED",   value: kpi.fl },
        { label: "AVG · IDEAS", value: kpi.ie.toFixed(1), format: "serif" },
        { label: "AVG · HQ",    value: kpi.hq.toFixed(1), format: "serif" },
        { label: "AVG · CONF",  value: kpi.cf.toFixed(2), format: "serif" },
        { label: "AVG · DUR",   value: fmtDuration(kpi.du) },
      ]} />

      <SectHead code="§ B · FILTER · BAR" sub="source / state / week / version / sort" />
      <FilterBar right={<span className="tg" style={{ color: "var(--night-soft)" }}>{rows.length} / {kpi.total}</span>}>
        <Seg label="SRC"   value={src}   options={["ALL","auto·post-close","auto·pre-open","manual"] as const} onChange={setSrc} />
        <Seg label="STATE" value={state} options={["ALL","ACTIVE","ARCHIVED","FAILED"] as const} onChange={setState} />
        <TextInput label="WEEK" value={week} onChange={setWeek} placeholder="2026-W17" />
        <TextInput label="VER"  value={ver}  onChange={setVer}  placeholder="v3.4" />
        <Sort value={sort} options={[
          { key: "startedAt",     label: "startedAt ↓" },
          { key: "ideasEmitted",  label: "ideas ↓" },
          { key: "avgConfidence", label: "conf ↓" },
        ] as const} onChange={setSort} />
      </FilterBar>

      <SectHead code="§ C · TABLE" sub="點 row 進 detail · /runs/[id]" />
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--night-rule-strong)", color: "var(--night-mid)" }}>
            {["ID","STARTED","SRC","IDEAS","HIGH-Q","CONF","DUR","VER","STATE"].map(h => (
              <th key={h} className="tg" style={{ textAlign: "left", padding: "8px 6px", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const active = r.state === "ACTIVE";
            const failed = r.state === "FAILED";
            return (
              <tr key={r.id} style={{
                borderBottom: "1px solid var(--night-rule)",
                color: active ? "var(--night-ink)" : "var(--night-mid)",
                opacity: failed ? 0.55 : 1,
              }}>
                <td style={{ padding: "10px 6px", color: "var(--gold)", fontWeight: 700 }}>
                  <Link href={`/runs/${encodeURIComponent(r.id)}`} style={{ color: "var(--gold)" }}>{r.id}</Link>
                </td>
                <td style={{ padding: "10px 6px" }}>{new Date(r.startedAt).toLocaleString("zh-TW", { hour12: false })}</td>
                <td style={{ padding: "10px 6px" }}>{r.source}</td>
                <td style={{ padding: "10px 6px", fontFeatureSettings: '"tnum","lnum"' }}>{r.ideasEmitted}</td>
                <td style={{ padding: "10px 6px", fontFeatureSettings: '"tnum","lnum"' }}>{r.highQualityCount}</td>
                <td style={{ padding: "10px 6px", fontFeatureSettings: '"tnum","lnum"' }}>{r.avgConfidence.toFixed(2)}</td>
                <td style={{ padding: "10px 6px" }}>{fmtDuration(r.durationMs)}</td>
                <td style={{ padding: "10px 6px" }}>{r.strategyVersion}</td>
                <td style={{ padding: "10px 6px",
                  color: active ? "var(--gold-bright)" : failed ? "var(--night-ink)" : "var(--night-soft)",
                  fontWeight: 700,
                }}>● {r.state}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={9} style={{
              padding: "26px 6px", textAlign: "center",
              color: "var(--night-soft)",
            }}>查無符合條件的 run</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
