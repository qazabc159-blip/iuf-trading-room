"use client";

/**
 * StrategyChartPanel — Stage 2 charts for /lab/three-strategy/[strategyId]
 *
 * Charts (pure SVG, zero new dependency):
 *   A. Equity curve line chart — amber polyline + drawdown shadow (red polygon)
 *   B. Monthly returns bar chart — amber/red bars
 *   C. Drawdown area chart — red fill + max DD marker
 *   D. Headline KPI grid (Sharpe / Sortino / maxDD / winRate / hitRate / avgHoldDays)
 *   E. Capacity warning banner (ALWAYS visible, NEVER hidden)
 *   Robustness 4-light panel (horizonSweep / regimeBandSweep / costStressSweep / universeShrinkage)
 *   F. Sample trades section (ALWAYS labelled 示範交易（非真實成交）)
 *
 * HARD LINES:
 *   - no fake / no inflated numbers
 *   - capacity banner ALWAYS visible
 *   - sample trades ALWAYS labelled 示範交易（非真實成交）
 *   - no 已驗證 / approved / 可上線
 */

import type { LabStrategySnapshot } from "@/lib/api";

// ── CSS ──────────────────────────────────────────────────────────────────────

const CHART_CSS = `
._chart-section {
  padding: 18px 20px;
  margin-bottom: 16px;
  background: rgba(11,16,23,0.82);
  border: 1px solid rgba(220,228,240,0.07);
  border-radius: 8px;
}
._chart-section-title {
  font-size: 10px;
  font-weight: 700;
  color: #888;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  font-family: var(--mono, monospace);
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
._chart-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1px;
  background: rgba(255,255,255,0.06);
  border-radius: 6px;
  overflow: hidden;
  margin-top: 4px;
}
._chart-kpi-cell {
  background: rgba(11,16,23,0.9);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
._chart-kpi-value {
  font-size: 26px;
  font-weight: 800;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
._chart-kpi-label {
  font-size: 10px;
  color: #666;
  letter-spacing: 0.4px;
  font-family: var(--mono, monospace);
}
._chart-kpi-sub {
  font-size: 9px;
  color: #ffb800;
  letter-spacing: 0.4px;
}
._chart-capacity-banner {
  padding: 12px 16px;
  margin-bottom: 16px;
  background: rgba(230,57,70,0.07);
  border: 1px solid rgba(230,57,70,0.3);
  border-left: 3px solid #e63946;
  border-radius: 5px;
  font-size: 13px;
  color: #ffaaaa;
  line-height: 1.65;
}
._chart-capacity-label {
  font-size: 10px;
  font-weight: 700;
  color: #e63946;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  font-family: var(--mono, monospace);
  margin-bottom: 6px;
}
._chart-demo-banner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: rgba(255,184,0,0.08);
  border: 1px solid rgba(255,184,0,0.3);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  color: #ffb800;
  letter-spacing: 0.6px;
  font-family: var(--mono, monospace);
  margin-bottom: 10px;
}
._chart-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--mono, monospace);
}
._chart-table th {
  text-align: left;
  font-size: 9px;
  font-weight: 700;
  color: #555;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding: 0 8px 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
._chart-table td {
  padding: 7px 8px 7px 0;
  color: #c0c0c0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  font-variant-numeric: tabular-nums;
}
._chart-table tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
._chart-table tr:last-child td { border-bottom: none; }
._chart-robust-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 4px;
}
._chart-robust-cell {
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
._chart-robust-label { font-size: 10px; color: #666; letter-spacing: 0.4px; font-family: var(--mono, monospace); }
._chart-robust-verdict { font-size: 12px; font-weight: 700; font-family: var(--mono, monospace); }
._chart-svg-wrap { position: relative; width: 100%; }
._chart-note { margin-top: 6px; font-size: 10px; color: #555; font-family: var(--mono, monospace); }
@media (prefers-reduced-motion: reduce) { ._chart-kpi-value { transition: none; } }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(v: number, digits = 1): string {
  return (v * 100).toFixed(digits) + "%";
}
function fmtFixed(v: number, digits = 2): string {
  return v.toFixed(digits);
}
function robustnessIcon(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v.includes("FULL_PASS") || v.includes("PASS_AT")) return "\u2713";
  if (v.includes("NEAR_PASS") || v.includes("PARTIAL")) return "\u26A0";
  return "\u2717";
}
function robustnessColor(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v.includes("FULL_PASS") || v.includes("PASS_AT")) return "#2ecc71";
  if (v.includes("NEAR_PASS") || v.includes("PARTIAL")) return "#ffb800";
  return "#e63946";
}
function robustnessLabel(key: string): string {
  const labels: Record<string, string> = {
    horizonSweep: "Horizon \u9b4f\u68d2",
    regimeBandSweep: "Regime \u9b4f\u68d2",
    costStressSweep: "Cost \u9b4f\u68d2",
    universeShrinkage: "Universe \u5bb9\u91cf",
  };
  return labels[key] ?? key;
}

// ── A. Equity Curve ───────────────────────────────────────────────────────────

function EquityCurveChart({
  points,
}: {
  points: { date: string; cumReturn: number; drawdown: number }[];
}) {
  if (!points || points.length < 2) {
    return <div style={{ color: "#555", fontSize: 12, padding: "20px 0", textAlign: "center" }}>\u8cc7\u6599\u4e0d\u8db3</div>;
  }
  const W = 620; const H = 220;
  const PAD = { top: 16, right: 20, bottom: 32, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const returns = points.map((p) => p.cumReturn);
  const minR = Math.min(0, ...returns);
  const maxR = Math.max(...returns);
  const rangeR = maxR - minR || 1;
  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const yScale = (v: number) => PAD.top + ((maxR - v) / rangeR) * innerH;
  const yTicks = Array.from({ length: 6 }, (_, i) => minR + (i / 5) * rangeR);
  const xStep = Math.max(1, Math.floor(points.length / 4));
  return (
    <div className="_chart-svg-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 260, display: "block" }} aria-label="\u7d2f\u7a4d\u5831\u916c\u6298\u7dda\u5716">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={PAD.left - 6} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#555" fontFamily="var(--mono,monospace)">{fmtPct(v, 0)}</text>
          </g>
        ))}
        {minR < 0 && <line x1={PAD.left} y1={yScale(0)} x2={W - PAD.right} y2={yScale(0)} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 3" />}
        {points.map((p, i) => {
          if (p.drawdown >= 0) return null;
          const x1 = xScale(i);
          const x2 = i < points.length - 1 ? xScale(i + 1) : x1;
          const y1 = yScale(p.cumReturn);
          const y2 = i < points.length - 1 ? yScale(points[i + 1].cumReturn) : y1;
          const ddY1 = yScale(p.cumReturn + p.drawdown);
          const ddY2 = i < points.length - 1 ? yScale(points[i + 1].cumReturn + points[i + 1].drawdown) : ddY1;
          return <polygon key={i} points={`${x1},${y1} ${x2},${y2} ${x2},${ddY2} ${x1},${ddY1}`} fill="rgba(230,57,70,0.18)" />;
        })}
        <polyline points={points.map((p, i) => `${xScale(i)},${yScale(p.cumReturn)}`).join(" ")} fill="none" stroke="#ffb800" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <circle key={i} cx={xScale(i)} cy={yScale(p.cumReturn)} r={3} fill="#ffb800" stroke="rgba(11,16,23,0.9)" strokeWidth={1.5} />)}
        {points.map((p, i) => {
          if (i % xStep !== 0 && i !== points.length - 1) return null;
          return <text key={i} x={xScale(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill="#555" fontFamily="var(--mono,monospace)">{p.date.slice(0, 7)}</text>;
        })}
        <text x={PAD.left} y={PAD.top - 4} fontSize={9} fill="#666" fontFamily="var(--mono,monospace)">\u7d2f\u7a4d\u6de8\u5831\u916c\uff08\u6263 120bps\uff09</text>
      </svg>
    </div>
  );
}

// ── B. Monthly Returns ────────────────────────────────────────────────────────

function MonthlyReturnsChart({ bars }: { bars: { yearMonth: string; monthReturn: number; tradeCount: number }[] }) {
  if (!bars || bars.length < 1) return <div style={{ color: "#555", fontSize: 12, padding: "20px 0", textAlign: "center" }}>\u7121\u6708\u5ea6\u5831\u916c\u8cc7\u6599</div>;
  const W = 620; const H = 180;
  const PAD = { top: 16, right: 20, bottom: 36, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const vals = bars.map((b) => b.monthReturn);
  const maxAbs = Math.max(0.01, ...vals.map(Math.abs));
  const yScale = (v: number) => PAD.top + ((maxAbs - v) / (2 * maxAbs)) * innerH;
  const barW = Math.max(4, (innerW / bars.length) * 0.7);
  const xStep = Math.max(1, Math.floor(bars.length / 5));
  return (
    <div className="_chart-svg-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 200, display: "block" }} aria-label="\u6708\u5ea6\u5831\u916c\u67f1\u72c0\u5716">
        {[0, maxAbs * 0.5, -maxAbs * 0.5].map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke={v === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"} strokeWidth={1} strokeDasharray={v === 0 ? "" : "3 3"} />
            <text x={PAD.left - 6} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#555" fontFamily="var(--mono,monospace)">{fmtPct(v, 0)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = PAD.left + (i / bars.length) * innerW + innerW / bars.length / 2;
          const col = b.monthReturn >= 0 ? "#ffb800" : "#e63946";
          const top = b.monthReturn >= 0 ? yScale(b.monthReturn) : yScale(0);
          const bot = b.monthReturn >= 0 ? yScale(0) : yScale(b.monthReturn);
          return <rect key={i} x={cx - barW / 2} y={top} width={barW} height={Math.max(2, bot - top)} fill={col} fillOpacity={0.82} rx={1} />;
        })}
        {bars.map((b, i) => {
          if (i % xStep !== 0 && i !== bars.length - 1) return null;
          const cx = PAD.left + (i / bars.length) * innerW + innerW / bars.length / 2;
          return <text key={i} x={cx} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill="#555" fontFamily="var(--mono,monospace)">{b.yearMonth.slice(2)}</text>;
        })}
        <text x={PAD.left} y={PAD.top - 4} fontSize={9} fill="#666" fontFamily="var(--mono,monospace)">\u6708\u5ea6\u5831\u916c\uff08amber=\u6b63 / red=\u8ca0\uff09</text>
      </svg>
    </div>
  );
}

// ── C. Drawdown Area ──────────────────────────────────────────────────────────

function DrawdownChart({ points, maxDrawdown, maxDrawdownDate }: { points: { date: string; drawdown: number }[]; maxDrawdown: number; maxDrawdownDate?: string }) {
  if (!points || points.length < 2) return <div style={{ color: "#555", fontSize: 12, padding: "20px 0", textAlign: "center" }}>\u7121\u56de\u64a4\u8cc7\u6599</div>;
  const W = 620; const H = 150;
  const PAD = { top: 16, right: 20, bottom: 32, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const ddVals = points.map((p) => p.drawdown);
  const minDD = Math.min(...ddVals, -0.01);
  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const yScale = (v: number) => PAD.top + ((0 - v) / (0 - minDD)) * innerH;
  const maxDDIdx = ddVals.indexOf(Math.min(...ddVals));
  const topPts = points.map((_, i) => `${xScale(i)},${yScale(0)}`).join(" ");
  const botPts = [...points].reverse().map((p, i) => `${xScale(points.length - 1 - i)},${yScale(p.drawdown)}`).join(" ");
  const xStep = Math.max(1, Math.floor(points.length / 4));
  return (
    <div className="_chart-svg-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 170, display: "block" }} aria-label="\u56de\u64a4\u9762\u7a4d\u5716">
        {[0, minDD * 0.5, minDD].map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke={v === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"} strokeWidth={1} strokeDasharray={v === 0 ? "" : "3 3"} />
            <text x={PAD.left - 6} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#555" fontFamily="var(--mono,monospace)">{fmtPct(v, 1)}</text>
          </g>
        ))}
        <polygon points={`${topPts} ${botPts}`} fill="rgba(230,57,70,0.22)" />
        <polyline points={points.map((p, i) => `${xScale(i)},${yScale(p.drawdown)}`).join(" ")} fill="none" stroke="#e63946" strokeWidth={1.5} strokeLinejoin="round" />
        {maxDDIdx >= 0 && maxDDIdx < points.length && (
          <>
            <circle cx={xScale(maxDDIdx)} cy={yScale(points[maxDDIdx].drawdown)} r={4} fill="#e63946" stroke="rgba(11,16,23,0.9)" strokeWidth={2} />
            <text x={xScale(maxDDIdx)} y={yScale(points[maxDDIdx].drawdown) - 8} textAnchor="middle" fontSize={9} fill="#e63946" fontFamily="var(--mono,monospace)">{fmtPct(minDD, 1)} Max</text>
          </>
        )}
        {points.map((p, i) => {
          if (i % xStep !== 0 && i !== points.length - 1) return null;
          return <text key={i} x={xScale(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill="#555" fontFamily="var(--mono,monospace)">{p.date.slice(0, 7)}</text>;
        })}
        <text x={PAD.left} y={PAD.top - 4} fontSize={9} fill="#666" fontFamily="var(--mono,monospace)">\u56de\u64a4\uff08Peak-to-trough\uff09</text>
      </svg>
      <div style={{ marginTop: 6, fontSize: 11, color: "#e63946", fontFamily: "var(--mono,monospace)", display: "flex", gap: 12 }}>
        <span><strong>\u6700\u5927\u56de\u64a4</strong> {fmtPct(maxDrawdown, 2)}</span>
        {maxDrawdownDate && <span style={{ color: "#888" }}>\u65e5\u671f {maxDrawdownDate}</span>}
      </div>
    </div>
  );
}

// ── D. KPI Grid ───────────────────────────────────────────────────────────────

function HeadlineKpiGrid({ metrics }: { metrics: { compoundReturn: number; sharpeAnnualized: number; sortinoAnnualized: number; maxDrawdown: number; winRate: number; hitRate: number; averageHoldingDays: number } }) {
  const cells = [
    { label: "\u7d2f\u7a4d\u5831\u916c", value: fmtPct(metrics.compoundReturn, 1), color: metrics.compoundReturn > 0 ? "#ffb800" : "#e63946" },
    { label: "Sharpe (\u5e74\u5316)", value: fmtFixed(metrics.sharpeAnnualized, 2), color: metrics.sharpeAnnualized >= 2 ? "#ffb800" : metrics.sharpeAnnualized >= 1 ? "#c8c8c8" : "#e63946", sub: metrics.sharpeAnnualized >= 2 ? "\u2605 \u512a\u7570" : undefined, glow: metrics.sharpeAnnualized >= 2 },
    { label: "Sortino (\u5e74\u5316)", value: fmtFixed(metrics.sortinoAnnualized, 2), color: metrics.sortinoAnnualized >= 2 ? "#a78bfa" : "#c8c8c8" },
    { label: "\u6700\u5927\u56de\u64a4", value: fmtPct(metrics.maxDrawdown, 1), color: "#e63946" },
    { label: "\u52dd\u7387", value: fmtPct(metrics.winRate, 1), color: metrics.winRate >= 0.7 ? "#2ecc71" : "#c8c8c8" },
    { label: "Hit Rate", value: fmtPct(metrics.hitRate, 1), color: metrics.hitRate >= 0.8 ? "#2ecc71" : "#c8c8c8" },
    { label: "\u5e73\u5747\u6301\u6709\u5929\u6578", value: `${metrics.averageHoldingDays}d`, color: "#c8c8c8" },
  ] as { label: string; value: string; color: string; sub?: string; glow?: boolean }[];
  return (
    <div className="_chart-kpi-grid">
      {cells.map((c) => (
        <div key={c.label} className="_chart-kpi-cell">
          <div className="_chart-kpi-value" style={{ color: c.color, boxShadow: c.glow ? "0 0 14px rgba(255,184,0,0.35)" : undefined }}>{c.value}</div>
          <div className="_chart-kpi-label">{c.label}</div>
          {c.sub && <div className="_chart-kpi-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Robustness 4-light ────────────────────────────────────────────────────────

function RobustnessPanel({ robustness }: { robustness: { horizonSweep: string; regimeBandSweep: string; costStressSweep: string; universeShrinkage: string } }) {
  const entries = [
    { key: "horizonSweep", verdict: robustness.horizonSweep },
    { key: "regimeBandSweep", verdict: robustness.regimeBandSweep },
    { key: "costStressSweep", verdict: robustness.costStressSweep },
    { key: "universeShrinkage", verdict: robustness.universeShrinkage },
  ];
  return (
    <div className="_chart-robust-grid">
      {entries.map(({ key, verdict }) => (
        <div key={key} className="_chart-robust-cell">
          <div className="_chart-robust-label">{robustnessLabel(key)}</div>
          <div className="_chart-robust-verdict" style={{ color: robustnessColor(verdict) }}>{robustnessIcon(verdict)} {verdict}</div>
        </div>
      ))}
    </div>
  );
}

// ── F. Sample Trades ──────────────────────────────────────────────────────────

function SampleTradesSection({ entries }: { entries: { rebalanceDate: string; holdingDays: number; holdingCount: number; turnover: number; netReturn120bps: number; benchmarkReturn: number; excessReturn120bps: number; uiLabel_zh: string }[] }) {
  return (
    <div>
      <div className="_chart-demo-banner">\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09</div>
      <div style={{ overflowX: "auto" }}>
        <table className="_chart-table">
          <thead>
            <tr>
              <th>\u518d\u5e73\u8861\u65e5</th><th>\u6301\u6709\u5929\u6578</th><th>\u6301\u5009\u6578</th><th>\u63db\u624b\u7387</th>
              <th>\u6de8\u5831\u916c (-120bps)</th><th>\u57fa\u6e96\u5831\u916c</th><th>\u8d85\u984d\u5831\u916c</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td style={{ color: "#888" }}>{e.rebalanceDate}</td>
                <td>{e.holdingDays}d</td>
                <td>{e.holdingCount}</td>
                <td>{fmtPct(e.turnover, 0)}</td>
                <td style={{ color: e.netReturn120bps >= 0 ? "#ffb800" : "#e63946", fontWeight: 700 }}>{fmtPct(e.netReturn120bps, 2)}</td>
                <td style={{ color: "#888" }}>{fmtPct(e.benchmarkReturn, 2)}</td>
                <td style={{ color: e.excessReturn120bps >= 0 ? "#2ecc71" : "#e63946" }}>{e.excessReturn120bps >= 0 ? "+" : ""}{fmtPct(e.excessReturn120bps, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="_chart-note">\u4f86\u6e90 / mock_for_demo (Athena snapshot_v0) \u00b7 \u975e\u771f\u5be6\u6210\u4ea4\u8a18\u9304</div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function StrategyChartPanel({ snapshot }: { snapshot: LabStrategySnapshot }) {
  const m = snapshot.headlineMetrics;
  const capacityWarning = snapshot.uiCopyHints?.warningBanner_zh ?? snapshot.spec.capacityCaveat ?? "\u9700\u6ce8\u610f\u5bb9\u91cf\u9650\u5236\uff0c\u8a73\u898b Athena \u9b4f\u68d2\u6027\u5831\u544a\u3002";
  return (
    <>
      <style>{CHART_CSS}</style>
      {/* E. Capacity Warning — always visible */}
      <div className="_chart-capacity-banner">
        <div className="_chart-capacity-label">\u5bb9\u91cf\u8b66\u544a\uff08\u6c38\u9060\u986f\u793a\uff09</div>
        {capacityWarning}
      </div>
      {/* D. KPI Grid */}
      <div className="_chart-section">
        <div className="_chart-section-title">\u7e3e\u6548\u95dc\u9375\u6307\u6a19</div>
        <HeadlineKpiGrid metrics={{ compoundReturn: m.compoundReturn, sharpeAnnualized: m.sharpeAnnualized, sortinoAnnualized: m.sortinoAnnualized, maxDrawdown: m.maxDrawdown, winRate: m.winRate, hitRate: m.hitRate, averageHoldingDays: m.averageHoldingDays }} />
      </div>
      {/* Robustness */}
      <div className="_chart-section">
        <div className="_chart-section-title">\u56db\u91cd\u9b4f\u68d2\u6027\u71c8\u865f</div>
        <RobustnessPanel robustness={m.robustness} />
      </div>
      {/* A. Equity Curve */}
      <div className="_chart-section">
        <div className="_chart-section-title">\u7d2f\u7a4d\u5831\u916c\u6298\u7dda\u5716\uff08Equity Curve\uff09</div>
        <EquityCurveChart points={snapshot.equityCurve.points} />
      </div>
      {/* B. Monthly Returns */}
      <div className="_chart-section">
        <div className="_chart-section-title">\u6708\u5ea6\u5831\u916c\u67f1\u72c0\u5716</div>
        <MonthlyReturnsChart bars={snapshot.monthlyReturns.bars} />
      </div>
      {/* C. Drawdown */}
      <div className="_chart-section">
        <div className="_chart-section-title">\u56de\u64a4\u5716\uff08Drawdown\uff09</div>
        <DrawdownChart
          points={snapshot.drawdownSeries?.points ?? snapshot.equityCurve.points.map((p) => ({ date: p.date, drawdown: p.drawdown }))}
          maxDrawdown={m.maxDrawdown}
          maxDrawdownDate={m.maxDrawdownDate}
        />
      </div>
      {/* F. Sample Trades */}
      <div className="_chart-section">
        <div className="_chart-section-title">\u793a\u7bc4\u518d\u5e73\u8861\u7d00\u9304\uff08Sample Trades\uff09</div>
        <SampleTradesSection entries={snapshot.sampleTrades.entries} />
      </div>
    </>
  );
}
