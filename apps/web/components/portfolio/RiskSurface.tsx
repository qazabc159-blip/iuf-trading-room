import Link from "next/link";
import type { CSSProperties } from "react";

import type { RiskLayerCell, RiskLayerName, RiskPortfolioOverview } from "@/lib/api";

export type RiskSurfaceState =
  | { state: "LIVE"; data: RiskPortfolioOverview; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };

const LAYERS: RiskLayerName[] = ["account", "strategy", "symbol", "session"];

function statusLabel(status: RiskLayerCell["status"]) {
  if (status === "ok") return "OK";
  if (status === "warn") return "WARN";
  if (status === "block") return "BLOCK";
  if (status === "blocked_killswitch") return "KILL";
  return "NO LIMIT";
}

function statusTone(status: RiskLayerCell["status"]) {
  if (status === "ok") return "var(--tw-dn-bright)";
  if (status === "warn") return "var(--gold-bright)";
  if (status === "block" || status === "blocked_killswitch") return "var(--tw-up-bright)";
  return "var(--exec-soft)";
}

function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `NT$ ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function numberText(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function pct(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${Math.round(value * 100)}%`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatValue(value: number, unit: RiskLayerCell["limit"]["unit"]) {
  if (unit === "ntd") return money(value);
  if (unit === "lots") return `${numberText(value)} lots`;
  return numberText(value);
}

function topContributor(cell: RiskLayerCell) {
  return cell.topContributors[0]?.key ?? "none";
}

function layerCaption(cell: RiskLayerCell) {
  if (cell.status !== "ok" && cell.reason) return cell.reason;
  const next = cell.topContributors[1];
  if (next) return `${next.key} ${formatValue(next.value, cell.limit.unit)}`;
  return cell.limit.kind;
}

function RiskCell({ cell }: { cell: RiskLayerCell }) {
  const util = Math.max(0, Math.min(1, cell.utilizationPct));
  const status = statusLabel(cell.status);
  const color = statusTone(cell.status);
  return (
    <Link
      aria-label={`${cell.layer} risk layer ${status}`}
      href={`/risk/limits?layer=${cell.layer}`}
      style={cellStyle}
      title={cell.reason ?? `Open ${cell.layer} risk limits`}
    >
      <div style={cellTopStyle}>
        <span>{cell.layer.toUpperCase()}</span>
        <span style={{ color }}>[{status}]</span>
      </div>
      <div style={contributorStyle}>{topContributor(cell)}</div>
      <div style={numericStyle}>
        {formatValue(cell.current, cell.limit.unit)} / {formatValue(cell.limit.value, cell.limit.unit)}
      </div>
      <div
        aria-label={`utilization ${Math.round(cell.utilizationPct * 100)} percent`}
        style={barTrackStyle}
      >
        <span
          style={{
            ...barFillStyle,
            width: `${util * 100}%`,
            background: color,
          }}
        />
      </div>
      <div style={footerStyle}>
        <span>{pct(cell.utilizationPct)} used</span>
        <span>{layerCaption(cell)}</span>
      </div>
    </Link>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; exposure: number; utilizationPct: number; status: string }>;
}) {
  return (
    <div>
      <div className="tg gold" style={{ marginBottom: 6 }}>{title}</div>
      {rows.length === 0 && <div className="terminal-note">EMPTY: backend returned no breakdown rows.</div>}
      {rows.slice(0, 5).map((row) => (
        <div className="row" key={`${title}-${row.key}`} style={breakdownRowStyle}>
          <span className="tg gold">{row.key}</span>
          <span className="num">{money(row.exposure)}</span>
          <span className="tg muted">{pct(row.utilizationPct)}</span>
          <span className="tg" style={{ color: row.status === "block" ? "var(--tw-up-bright)" : row.status === "warn" ? "var(--gold-bright)" : "var(--tw-dn-bright)" }}>
            {row.status}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RiskSurface({ result }: { result: RiskSurfaceState }) {
  if (result.state === "BLOCKED") {
    return (
      <div>
        <div className="tg soft" style={sourceStyle}>
          <span style={{ color: "var(--tw-up-bright)", fontWeight: 700 }}>BLOCKED</span>
          <span>{result.source}</span>
          <span>checked {formatTime(result.updatedAt)}</span>
        </div>
        <div className="terminal-note">
          <span className="tg down">BLOCKED</span>{" "}
          Risk Surface is hidden because the portfolio overview endpoint is unavailable: {result.reason}. Owner: Jason backend contract, Codex frontend wire.
        </div>
      </div>
    );
  }

  const { data } = result;
  const isEmpty = data.positionAttribution.length === 0;
  return (
    <div>
      <div className="tg soft" style={sourceStyle}>
        <span style={{ color: "var(--tw-dn-bright)", fontWeight: 700 }}>LIVE</span>
        <span>{result.source}</span>
        <span>generated {formatTime(data.generatedAt)}</span>
        <span>kill {data.killSwitchState}</span>
        <span>paper {data.paperGateState}</span>
      </div>
      {isEmpty && (
        <div className="terminal-note">
          <span className="tg gold">EMPTY</span>{" "}
          No positions returned for risk attribution; layer limits are still rendered from the live overview payload.
        </div>
      )}
      <div style={gridStyle}>
        {LAYERS.map((layer) => (
          <RiskCell cell={data.layers[layer]} key={layer} />
        ))}
      </div>
      <details style={detailsStyle}>
        <summary className="tg gold" style={{ cursor: "pointer" }}>TOP EXPOSURE BREAKDOWN</summary>
        <div style={breakdownGridStyle}>
          <Breakdown
            title="TOP STRATEGIES"
            rows={data.strategyBreakdown.map((row) => ({
              key: row.strategyTag,
              exposure: row.exposureNtd,
              utilizationPct: row.utilizationPct,
              status: row.status,
            }))}
          />
          <Breakdown
            title="TOP SYMBOLS"
            rows={data.symbolBreakdown.map((row) => ({
              key: row.symbol,
              exposure: row.exposureNtd,
              utilizationPct: row.utilizationPct,
              status: row.status,
            }))}
          />
        </div>
      </details>
    </div>
  );
}

const sourceStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 14px",
  margin: "10px 0 12px",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(150px, 1fr))",
  gap: 10,
};

const cellStyle: CSSProperties = {
  display: "block",
  minHeight: 126,
  padding: "12px 12px 10px",
  border: "1px solid var(--exec-rule-strong)",
  background: "rgba(255,255,255,0.018)",
};

const cellTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  color: "var(--gold-bright)",
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 700,
};

const contributorStyle: CSSProperties = {
  marginTop: 11,
  color: "var(--exec-ink)",
  fontFamily: "var(--mono)",
  fontSize: 14,
  fontWeight: 700,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const numericStyle: CSSProperties = {
  marginTop: 5,
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 11,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const barTrackStyle: CSSProperties = {
  height: 8,
  marginTop: 12,
  border: "1px solid var(--exec-rule)",
  background: "var(--exec-bg-2)",
};

const barFillStyle: CSSProperties = {
  display: "block",
  height: "100%",
};

const footerStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  marginTop: 9,
  color: "var(--exec-soft)",
  fontFamily: "var(--mono)",
  fontSize: 10,
};

const detailsStyle: CSSProperties = {
  marginTop: 12,
  borderTop: "1px solid var(--exec-rule)",
  paddingTop: 10,
};

const breakdownGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 20,
  marginTop: 12,
};

const breakdownRowStyle: CSSProperties = {
  gridTemplateColumns: "minmax(90px, 1fr) 118px 58px 64px",
  gap: 8,
  padding: "8px 0",
};
