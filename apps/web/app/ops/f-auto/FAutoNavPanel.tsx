"use client";

/**
 * F-AUTO NAV Curve Panel
 * Consumes GET /api/v1/portfolio/f-auto/nav (Owner-only)
 *
 * Sections:
 *  1. 連續權益曲線（SVG，可切換 TWD / 報酬%）
 *  2. 累計摘要列（本金、現權益、含成本累計報酬、已實現損益）
 *  3. 週次表（逐週重平衡日 / 部署成本 / 已實現損益 / 期末權益）
 *
 * 誠實標示：
 *  - source=backfill 或 backfill_dry_run 的資料段標「歷史回補（依審計紀錄重建）」
 *  - source=empty_ledger → 顯誠實空狀態
 *  - 空帳本不顯示圖表
 */

import { useState } from "react";
import {
  fmtTwd,
  type FAutoNavResponse,
  type NavCurvePoint,
  type NavWeekRow,
} from "@/lib/fauto-sim-api";
import { DataStateBadge } from "@/components/DataStateBadge";

// ─── colour constants (CRT palette) ──────────────────────────────────────────

const CLR_GREEN  = "#4adb88";
const CLR_RED    = "#ff6b77";
const CLR_AMBER  = "#e2b85c";
const CLR_MUTED  = "rgba(145,160,181,0.55)";
const CLR_GRID   = "rgba(220,228,240,0.08)";
const CLR_AXIS   = "rgba(145,160,181,0.30)";
const CLR_BG     = "rgba(8,11,16,0.82)";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNavDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00+08:00");
    return d.toLocaleDateString("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateStr.slice(5, 10);
  }
}

function fmtPctSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function pnlColorClass(value: number): string {
  return value >= 0 ? "_fnav-pos" : "_fnav-neg";
}

function isBackfillPoint(source: string): boolean {
  return source === "backfill" || source === "backfill_dry_run";
}

// Source label for the legend annotation
function sourceAnnotation(navCurve: NavCurvePoint[]): string | null {
  const hasBackfill = navCurve.some((p) => isBackfillPoint(p.source));
  if (!hasBackfill) return null;
  const firstLive = navCurve.find((p) => p.source === "live");
  if (firstLive) {
    return `${fmtNavDate(navCurve[0].navDate)} – ${fmtNavDate(firstLive.navDate)} 為歷史回補（依審計紀錄重建），${fmtNavDate(firstLive.navDate)} 起為 live 帳本記錄。`;
  }
  return "本曲線為歷史回補（依審計紀錄重建），尚無 live 帳本記錄。";
}

// ─── SVG NAV Chart ───────────────────────────────────────────────────────────

type YMode = "equity" | "pct";

type NavChartProps = {
  navCurve: NavCurvePoint[];
  weeks: NavWeekRow[];
  initialEquity: number;
  yMode: YMode;
};

function NavChart({ navCurve, weeks, initialEquity, yMode }: NavChartProps) {
  if (navCurve.length === 0) return null;

  const W = 760;
  const H = 240;
  const PAD = { l: 72, r: 24, t: 28, b: 44 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  // y-values
  const yValues = yMode === "equity"
    ? navCurve.map((p) => p.equityTwd)
    : navCurve.map((p) => p.returnPct);

  const baseline = yMode === "equity" ? initialEquity : 0;
  const yMin = Math.min(...yValues, baseline);
  const yMax = Math.max(...yValues, baseline);
  const yRange = yMax - yMin || 1;
  // small padding so line doesn't touch edges
  const yLo = yMin - yRange * 0.06;
  const yHi = yMax + yRange * 0.06;
  const ySpan = yHi - yLo || 1;

  function toX(index: number) {
    return PAD.l + (index / Math.max(navCurve.length - 1, 1)) * innerW;
  }
  function toY(val: number) {
    return PAD.t + (1 - (val - yLo) / ySpan) * innerH;
  }

  // baseline y pixel
  const baselineY = toY(baseline);

  // SVG coords for each point
  const coords = navCurve.map((p, i) => ({
    x: toX(i),
    y: toY(yMode === "equity" ? p.equityTwd : p.returnPct),
    p,
  }));

  // Line path (all points)
  const linePts = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");

  // Area above/below baseline
  const areaPtsAbove = [
    ...coords.map((c) => `${c.x.toFixed(2)},${Math.min(c.y, baselineY).toFixed(2)}`),
    `${coords.at(-1)!.x.toFixed(2)},${baselineY.toFixed(2)}`,
    `${coords[0].x.toFixed(2)},${baselineY.toFixed(2)}`,
  ].join(" ");

  const areaColor = (yValues.at(-1) ?? baseline) >= baseline ? CLR_GREEN : CLR_RED;
  const lineColor = areaColor;

  // y-axis grid lines (5 steps)
  const yGridSteps = 5;
  const yGridValues: number[] = [];
  for (let s = 0; s <= yGridSteps; s++) {
    yGridValues.push(yLo + (s / yGridSteps) * ySpan);
  }

  function fmtYLabel(val: number): string {
    if (yMode === "equity") {
      return `${(val / 10000).toFixed(0)}萬`;
    }
    return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  }

  // x-axis labels: show ~5 dates (or all if <=5)
  const xLabelStep = Math.max(1, Math.floor(navCurve.length / 5));
  const xLabels = navCurve
    .map((p, i) => ({ i, label: fmtNavDate(p.navDate), x: toX(i) }))
    .filter((_, i) => i === 0 || i === navCurve.length - 1 || i % xLabelStep === 0);

  // Week rebalance markers: first point of each new weekNum
  const weekMarkers: Array<{
    x: number;
    y: number;
    weekNum: number;
    weekData: NavWeekRow | undefined;
    p: NavCurvePoint;
  }> = [];
  let lastWeekNum = -1;
  coords.forEach((c) => {
    if (c.p.weekNum !== lastWeekNum) {
      lastWeekNum = c.p.weekNum;
      const weekData = weeks.find((w) => w.weekNum === c.p.weekNum);
      weekMarkers.push({ x: c.x, y: c.y, weekNum: c.p.weekNum, weekData, p: c.p });
    }
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="F-AUTO S1 連續 NAV 權益曲線"
      className="_fnav-svg"
    >
      {/* Grid lines */}
      {yGridValues.map((val, i) => {
        const gy = toY(val);
        return (
          <g key={`grid-${i}`}>
            <line
              x1={PAD.l}
              y1={gy}
              x2={W - PAD.r}
              y2={gy}
              stroke={CLR_GRID}
              strokeWidth="1"
            />
            <text
              x={PAD.l - 6}
              y={gy + 4}
              fill={CLR_MUTED}
              fontSize="10"
              fontFamily="monospace"
              textAnchor="end"
            >
              {fmtYLabel(val)}
            </text>
          </g>
        );
      })}

      {/* Baseline (1000萬 / 0%) */}
      <line
        x1={PAD.l}
        y1={baselineY}
        x2={W - PAD.r}
        y2={baselineY}
        stroke={CLR_AMBER}
        strokeWidth="1"
        strokeDasharray="6 4"
        opacity="0.50"
      />
      <text
        x={W - PAD.r + 3}
        y={baselineY + 4}
        fill={CLR_AMBER}
        fontSize="9"
        fontFamily="monospace"
        opacity="0.55"
      >
        {yMode === "equity" ? `${(initialEquity / 10000).toFixed(0)}萬` : "0%"}
      </text>

      {/* Area fill */}
      <polygon
        points={areaPtsAbove}
        fill={areaColor}
        opacity="0.08"
      />

      {/* Main line */}
      <polyline
        points={linePts}
        fill="none"
        stroke={lineColor}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* x-axis line */}
      <line
        x1={PAD.l}
        y1={H - PAD.b}
        x2={W - PAD.r}
        y2={H - PAD.b}
        stroke={CLR_AXIS}
        strokeWidth="1"
      />

      {/* x-axis labels */}
      {xLabels.map(({ i, label, x }) => (
        <text
          key={`xl-${i}`}
          x={x}
          y={H - PAD.b + 14}
          fill={CLR_MUTED}
          fontSize="10"
          fontFamily="monospace"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}

      {/* Week rebalance markers */}
      {weekMarkers.map(({ x, y, weekNum, weekData, p }) => {
        const tooltipPnl = weekData?.realizedPnlTwd ?? null;
        const tooltipText = tooltipPnl != null
          ? `W${weekNum} 重平衡 ${fmtNavDate(p.navDate)}\n已實現損益 ${tooltipPnl >= 0 ? "+" : ""}${Math.round(tooltipPnl).toLocaleString("zh-TW")} TWD`
          : `W${weekNum} 重平衡 ${fmtNavDate(p.navDate)}`;
        return (
          <g key={`wk-${weekNum}`} style={{ cursor: "default" }}>
            <circle
              cx={x}
              cy={y}
              r="5"
              fill={CLR_BG}
              stroke={CLR_AMBER}
              strokeWidth="1.5"
              opacity="0.90"
            />
            <text
              x={x}
              y={y - 9}
              fill={CLR_AMBER}
              fontSize="9"
              fontFamily="monospace"
              textAnchor="middle"
              opacity="0.80"
            >
              {`W${weekNum}`}
            </text>
            <title>{tooltipText}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Cumulative Summary Row ───────────────────────────────────────────────────

function NavSummaryRow({ data }: { data: FAutoNavResponse }) {
  const { summary } = data;
  const pnlCls = pnlColorClass(summary.cumulativeReturnPct);
  const realizedCls = pnlColorClass(summary.totalRealizedPnlTwd);
  return (
    <div className="_fnav-summary-row" aria-label="累計績效摘要">
      <div>
        <span>起始本金</span>
        <strong>{fmtTwd(summary.initialEquity)}</strong>
        <small>F-AUTO SIM 初始配置</small>
      </div>
      <div>
        <span>目前權益</span>
        <strong className={pnlCls}>{fmtTwd(summary.currentEquity)}</strong>
        <small>W{summary.currentWeekNum} 末 · {fmtNavDate(summary.lastNavDate)}</small>
      </div>
      <div className={pnlCls}>
        <span>累計報酬（含成本）</span>
        <strong>{fmtPctSigned(summary.cumulativeReturnPct)}</strong>
        <small>含手續費與證交稅</small>
      </div>
      <div className={realizedCls}>
        <span>累計已實現損益</span>
        <strong>{fmtTwd(summary.totalRealizedPnlTwd)}</strong>
        <small>{data.weeks.length} 週合計</small>
      </div>
    </div>
  );
}

// ─── Weekly Table ─────────────────────────────────────────────────────────────

function NavWeekTable({ weeks }: { weeks: NavWeekRow[] }) {
  if (weeks.length === 0) return null;
  return (
    <div className="_fnav-week-section">
      <div className="_fnav-week-head">逐週紀錄</div>
      <table className="_fnav-tbl">
        <thead>
          <tr>
            <th>週次</th>
            <th>重平衡日</th>
            <th className="_fnav-r">部署成本</th>
            <th className="_fnav-r">已實現損益</th>
            <th className="_fnav-r">期末權益</th>
            <th className="_fnav-r">現金剩餘</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekNum}>
              <td className="_fnav-wk-badge">W{w.weekNum}</td>
              <td className="_fnav-date">{fmtNavDate(w.basketDate)}</td>
              <td className="_fnav-r">{fmtTwd(w.basketCostTwd)}</td>
              <td className={`_fnav-r ${pnlColorClass(w.realizedPnlTwd)}`}>
                {w.realizedPnlTwd >= 0 ? "+" : ""}{fmtTwd(w.realizedPnlTwd)}
              </td>
              <td className="_fnav-r">{fmtTwd(w.equityAfterTwd)}</td>
              <td className="_fnav-r _fnav-muted">{fmtTwd(w.cashResidualTwd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

type FAutoNavPanelProps = {
  /** AsyncState from parent's useFetch(getFAutoNav, tick) */
  data: FAutoNavResponse | null;
  phase: "loading" | "error" | "empty" | "live" | "pending_backend";
  errorMessage?: string;
};

export function FAutoNavPanel({ data, phase, errorMessage }: FAutoNavPanelProps) {
  const [yMode, setYMode] = useState<YMode>("pct");

  return (
    <section className="_fnav-root" aria-label="F-AUTO S1 連續損益曲線">
      <style>{NAV_CSS}</style>

      {/* Panel header */}
      <div className="_fnav-head">
        <div className="_fnav-head-left">
          <span className="_fnav-code">NAV-CURVE</span>
          <span className="_fnav-title">連續賺賠曲線</span>
          <span className="_fnav-sub">S1 F-AUTO SIM · 6/2 起 · 週 Rebalance</span>
        </div>
        {phase === "live" && data && data.source !== "empty_ledger" && (
          <div className="_fnav-toggle">
            <button
              type="button"
              className={`_fnav-toggle-btn ${yMode === "pct" ? "_fnav-toggle-active" : ""}`}
              onClick={() => setYMode("pct")}
            >
              報酬 %
            </button>
            <button
              type="button"
              className={`_fnav-toggle-btn ${yMode === "equity" ? "_fnav-toggle-active" : ""}`}
              onClick={() => setYMode("equity")}
            >
              權益 TWD
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="_fnav-body">
        {phase === "loading" && (
          <div className="_fnav-state">
            <DataStateBadge state="empty" label="NAV 曲線載入中…" testId="fnav-loading-badge" />
          </div>
        )}
        {phase === "error" && (
          <div className="_fnav-state _fnav-state-err">
            NAV 曲線讀取失敗 / {errorMessage ?? "未知錯誤"}
          </div>
        )}
        {phase === "pending_backend" && (
          <div className="_fnav-state _fnav-state-pending">
            <span className="_fnav-dot" />
            NAV 帳本 — 等待後端 endpoint 上線或帳本回補完成
          </div>
        )}
        {phase === "empty" && (
          <div className="_fnav-state _fnav-state-pending">尚無 NAV 紀錄</div>
        )}

        {phase === "live" && data && data.source === "empty_ledger" && (
          <div className="_fnav-state _fnav-state-pending">
            帳本尚未建立 — 待 Jason 執行回補後自動顯示
          </div>
        )}

        {phase === "live" && data && data.source !== "empty_ledger" && (
          <>
            {/* Source annotation for backfill segments */}
            {(() => {
              const note = sourceAnnotation(data.navCurve);
              return note ? (
                <div className="_fnav-backfill-note">{note}</div>
              ) : null;
            })()}

            {/* SVG chart */}
            <div className="_fnav-chart-wrap">
              <NavChart
                navCurve={data.navCurve}
                weeks={data.weeks}
                initialEquity={data.summary.initialEquity}
                yMode={yMode}
              />
            </div>

            {/* Cumulative summary */}
            <NavSummaryRow data={data} />

            {/* Weekly table */}
            <NavWeekTable weeks={data.weeks} />
          </>
        )}
      </div>
    </section>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const NAV_CSS = `
/* F-AUTO NAV Curve panel styles */
._fnav-root {
  border: 1px solid rgba(200,148,63,0.22);
  border-radius: 6px;
  background: rgba(8,11,16,0.82);
  margin-bottom: 14px;
  overflow: hidden;
}

._fnav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 18px 11px;
  border-bottom: 1px solid rgba(220,228,240,0.07);
  background: rgba(255,255,255,0.02);
  flex-wrap: wrap;
}
._fnav-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
._fnav-code {
  font-size: 9px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.08em;
  color: rgba(145,160,181,0.45);
  text-transform: uppercase;
}
._fnav-title {
  font-size: 14px;
  font-weight: 700;
  color: #e7ecf3;
}
._fnav-sub {
  font-size: 11px;
  color: rgba(145,160,181,0.55);
  font-family: var(--mono, monospace);
}

/* Y-mode toggle */
._fnav-toggle {
  display: flex;
  gap: 4px;
}
._fnav-toggle-btn {
  font-size: 11px;
  font-family: var(--mono, monospace);
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 2px;
  border: 1px solid rgba(220,228,240,0.14);
  background: transparent;
  color: rgba(145,160,181,0.60);
  cursor: pointer;
  transition: all 0.10s;
}
._fnav-toggle-btn:hover { background: rgba(255,255,255,0.04); }
._fnav-toggle-active {
  background: rgba(200,148,63,0.12);
  border-color: rgba(200,148,63,0.30);
  color: #e2b85c;
}

._fnav-body { padding: 14px 18px; }

/* State messages */
._fnav-state {
  padding: 24px 0;
  font-size: 12px;
  color: rgba(145,160,181,0.55);
  text-align: center;
  font-style: italic;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
._fnav-state-err { color: #ff6b77; font-style: normal; }
._fnav-state-pending { color: rgba(200,148,63,0.70); font-style: normal; }
._fnav-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(200,148,63,0.70);
  flex-shrink: 0;
}

/* Backfill annotation */
._fnav-backfill-note {
  font-size: 11px;
  font-style: italic;
  color: rgba(145,160,181,0.50);
  margin-bottom: 10px;
  padding: 6px 10px;
  border-left: 2px solid rgba(145,160,181,0.22);
  line-height: 1.55;
}

/* Chart */
._fnav-chart-wrap {
  width: 100%;
  overflow-x: auto;
  margin-bottom: 14px;
}
._fnav-svg { display: block; min-width: 320px; }

/* Summary row (4 cols) */
._fnav-summary-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid rgba(220,228,240,0.08);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 14px;
}
._fnav-summary-row > div {
  padding: 12px 14px;
  border-right: 1px solid rgba(220,228,240,0.07);
}
._fnav-summary-row > div:last-child { border-right: none; }
._fnav-summary-row span,
._fnav-summary-row small {
  display: block;
  color: rgba(145,160,181,0.60);
  font: 700 10px/1.4 var(--mono, monospace);
}
._fnav-summary-row strong {
  display: block;
  color: #e7ecf3;
  font: 800 17px/1.2 var(--mono, monospace);
  margin: 5px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
._fnav-pos strong, ._fnav-pos small { color: #4adb88; }
._fnav-neg strong, ._fnav-neg small { color: #ff6b77; }

@media (max-width: 900px) {
  ._fnav-summary-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  ._fnav-summary-row > div { border-bottom: 1px solid rgba(220,228,240,0.07); }
}
@media (max-width: 560px) {
  ._fnav-summary-row { grid-template-columns: 1fr; }
  ._fnav-head-left { flex-wrap: wrap; }
}

/* Week section */
._fnav-week-section { margin-top: 2px; }
._fnav-week-head {
  font-size: 10px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.45);
  margin-bottom: 8px;
}

/* Weekly table */
._fnav-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
}
._fnav-tbl th {
  text-align: left;
  color: rgba(145,160,181,0.50);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 4px 6px 6px;
  border-bottom: 1px solid rgba(220,228,240,0.08);
}
._fnav-tbl td {
  padding: 7px 6px;
  border-bottom: 1px solid rgba(220,228,240,0.04);
  color: rgba(220,228,240,0.75);
  vertical-align: middle;
}
._fnav-tbl tr:last-child td { border-bottom: none; }
._fnav-r { text-align: right; }
._fnav-wk-badge {
  font-size: 10px;
  font-weight: 800;
  color: #e2b85c;
  letter-spacing: 0.06em;
}
._fnav-date { color: rgba(145,160,181,0.65); }
._fnav-muted { color: rgba(145,160,181,0.50); }
._fnav-pos { color: #4adb88; }
._fnav-neg { color: #ff6b77; }
`;
