"use client";
/**
 * TopKpiStrip — W4 Fix 2
 * 7-cell top KPI bar: 總部位 / 今日PnL / 勝率 / 風險使用率 / 訊號數 / 持倉檔 / 市場狀態
 * Each cell: label (tg) + large value (serif-italic or mono) + delta (red/green) + mini sparkline (SVG)
 *
 * StatStrip — individual stock page 8-cell stat strip
 * last / Δ% / vol / turnover / high / low / open / prev-close
 *
 * Ported from sandbox v0.7.0-w4.
 * TW market convention: gain = red (--tw-up), loss = green (--tw-dn).
 */

import { useMemo } from "react";

interface KpiCell {
  label:       string;
  value:       string;
  sub?:        string;
  delta?:      number;
  spark?:      number[];
  valueStyle?: "mono" | "serif" | "serif-italic";
  statusColor?: string;
}

function MiniSparkline({ values, color = "var(--gold)" }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 72, H = 24;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");

  const lv = values[values.length - 1];
  const lx = W;
  const ly = H - ((lv - min) / range) * H;

  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={lx} cy={ly} r={2} fill={color} />
    </svg>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const color = up ? "var(--tw-up)" : "var(--tw-dn)";
  const sign = up ? "▲" : "▼";
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color, fontWeight: 700, letterSpacing: "0.08em", marginLeft: 4 }}>
      {sign} {Math.abs(delta).toFixed(2)}%
    </span>
  );
}

function KpiCellView({ cell, last }: { cell: KpiCell; last: boolean }) {
  const valueColor = cell.statusColor ?? "var(--night-ink)";
  const valueFont  = cell.valueStyle === "mono" ? "var(--mono)" : "var(--serif-en)";
  const valueFontSize = cell.valueStyle === "mono" ? 22 : 26;

  return (
    <div style={{
      padding:      "12px 16px",
      borderRight:  !last ? "1px solid var(--night-rule-strong)" : "none",
      display:      "flex",
      flexDirection:"column",
      gap:          2,
      minWidth:     0,
    }}>
      <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 4 }}>{cell.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{
          fontFamily:    valueFont,
          fontSize:      valueFontSize,
          fontStyle:     cell.valueStyle !== "mono" ? "italic" : "normal",
          fontWeight:    cell.valueStyle === "mono" ? 700 : 300,
          color:         valueColor,
          letterSpacing: cell.valueStyle === "mono" ? "0.04em" : 0,
          lineHeight:    1,
        }}>{cell.value}</span>
        {cell.delta !== undefined && <DeltaBadge delta={cell.delta} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        {cell.sub && (
          <span className="tg" style={{ color: "var(--night-soft)", fontSize: 9 }}>{cell.sub}</span>
        )}
        {cell.spark && (
          <MiniSparkline
            values={cell.spark}
            color={cell.delta !== undefined && cell.delta < 0 ? "var(--tw-dn)" : "var(--gold)"}
          />
        )}
      </div>
    </div>
  );
}

interface TopKpiStripProps {
  positions?:     Array<{ pnlTwd: number; pctNav: number; lastPx: number; changePct: number }>;
  signals?:       number;
  positionCount?: number;
  marketState?:   string;
  killMode?:      string;
}

export function TopKpiStrip({
  positions     = [],
  signals       = 18,
  positionCount = 6,
  marketState   = "POST-CLOSE",
  killMode      = "ARMED",
}: TopKpiStripProps) {
  const cells = useMemo<KpiCell[]>(() => {
    const totalNav = 4_304_200;
    const todayPnl = positions.reduce((s, p) => s + p.pnlTwd, 0);
    const todayPnlPct = (todayPnl / (totalNav - todayPnl)) * 100;
    const grossNotional = positions.reduce((s, p) => s + p.pctNav, 0);
    const winRate = positions.filter(p => p.pnlTwd > 0).length / Math.max(1, positions.length);
    const marketStateColor =
      marketState === "OPEN"       ? "var(--tw-up)" :
      marketState === "POST-CLOSE" || marketState === "PRE-OPEN" ? "var(--gold-bright)" :
      "var(--night-mid)";

    return [
      {
        label: "總部位·NAV", value: `${(totalNav / 1_000_000).toFixed(2)}M`, sub: "TWD",
        spark: [4.08, 4.10, 4.12, 4.15, 4.18, 4.22, totalNav / 1_000_000],
        valueStyle: "serif",
      },
      {
        label: "今日 · PnL",
        value: todayPnl >= 0 ? `+${(todayPnl / 1000).toFixed(0)}K` : `${(todayPnl / 1000).toFixed(0)}K`,
        sub: "TWD", delta: todayPnlPct,
        spark: [12, 18, 22, 31, 28, 38, todayPnlPct],
        valueStyle: "serif",
        statusColor: todayPnl >= 0 ? "var(--tw-up)" : "var(--tw-dn)",
      },
      {
        label: "勝率", value: `${(winRate * 100).toFixed(0)}%`,
        sub: `${positions.filter(p => p.pnlTwd > 0).length} / ${positions.length} 持倉`,
        spark: [55, 62, 58, 66, 60, 64, winRate * 100],
        valueStyle: "serif",
        statusColor: winRate >= 0.6 ? "var(--tw-up)" : winRate >= 0.4 ? "var(--night-ink)" : "var(--tw-dn)",
      },
      {
        label: "風險使用率", value: `${grossNotional.toFixed(1)}%`, sub: "of NAV",
        delta: grossNotional > 80 ? 1.2 : 0,
        spark: [22, 24, 26, 28, 27, 31, grossNotional],
        valueStyle: "serif",
        statusColor: grossNotional > 80 ? "var(--tw-up)" : grossNotional > 50 ? "var(--gold-bright)" : "var(--night-ink)",
      },
      {
        label: "訊號數", value: String(signals), sub: "d1 active",
        spark: [8, 12, 15, 11, 14, 16, signals],
        valueStyle: "serif",
      },
      {
        label: "持倉檔數", value: String(positionCount),
        sub: `${positions.filter(p => p.changePct > 0).length}↑ ${positions.filter(p => p.changePct < 0).length}↓`,
        spark: [5, 6, 6, 7, 6, 7, positionCount],
        valueStyle: "mono",
      },
      {
        label: "市場狀態", value: marketState,
        sub: `KILL·${killMode}`,
        valueStyle: "mono",
        statusColor: marketStateColor,
      },
    ];
  }, [positions, signals, positionCount, marketState, killMode]);

  return (
    <div style={{
      display:             "grid",
      gridTemplateColumns: "repeat(7, 1fr)",
      border:              "1px solid var(--night-rule-strong)",
      borderBottom:        "2px solid var(--gold)",
      marginBottom:        24,
    }}>
      {cells.map((cell, i) => (
        <KpiCellView key={cell.label} cell={cell} last={i === cells.length - 1} />
      ))}
    </div>
  );
}

/* ─── StatStrip ──────────────────────────────────────────────── */

interface StatCell {
  label:  string;
  value:  string;
  color?: string;
}

export function StatStrip({ cells }: { cells: StatCell[] }) {
  return (
    <div style={{
      display:             "grid",
      gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
      border:              "1px solid var(--night-rule-strong)",
      borderBottom:        "2px solid var(--gold)",
      marginBottom:        16,
    }}>
      {cells.map((cell, i) => (
        <div key={cell.label} style={{
          padding:     "10px 14px",
          borderRight: i < cells.length - 1 ? "1px solid var(--night-rule)" : "none",
        }}>
          <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 4 }}>{cell.label}</div>
          <div style={{
            fontFamily: "var(--serif-en)",
            fontSize:   20,
            fontStyle:  "italic",
            fontWeight: 300,
            color:      cell.color ?? "var(--night-ink)",
            lineHeight: 1,
          }}>{cell.value}</div>
        </div>
      ))}
    </div>
  );
}
