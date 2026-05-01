import Link from "next/link";
import type { CSSProperties } from "react";

import type { RiskLayerCell, RiskLayerName, RiskPortfolioOverview } from "@/lib/api";

export type RiskSurfaceState =
  | { state: "LIVE"; data: RiskPortfolioOverview; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };

const LAYERS: RiskLayerName[] = ["account", "strategy", "symbol", "session"];

function statusLabel(status: RiskLayerCell["status"]) {
  if (status === "ok") return "正常";
  if (status === "warn") return "注意";
  if (status === "block") return "阻擋";
  if (status === "blocked_killswitch") return "鎖定";
  return "未設定";
}

function statusTone(status: RiskLayerCell["status"]) {
  if (status === "ok") return "var(--tw-dn-bright)";
  if (status === "warn") return "var(--gold-bright)";
  if (status === "block" || status === "blocked_killswitch") return "var(--tw-up-bright)";
  return "var(--exec-soft)";
}

function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `NT$ ${value.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
}

function numberText(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
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
  if (unit === "lots") return `${numberText(value)} 張`;
  return numberText(value);
}

function topContributor(cell: RiskLayerCell) {
  return cell.topContributors[0]?.key ?? "無主要曝險";
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
      aria-label={`${layerName(cell.layer)}風控層 ${status}`}
      href={`/risk/limits?layer=${cell.layer}`}
      style={cellStyle}
      title={cell.reason ?? `查看${layerName(cell.layer)}風控限制`}
    >
      <div style={cellTopStyle}>
        <span>{layerName(cell.layer)}</span>
        <span style={{ color }}>{status}</span>
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
        <span>已使用 {pct(cell.utilizationPct)}</span>
        <span>{layerCaption(cell)}</span>
      </div>
    </Link>
  );
}

function layerName(layer: RiskLayerName) {
  if (layer === "account") return "帳戶";
  if (layer === "strategy") return "策略";
  if (layer === "symbol") return "個股";
  return "盤中";
}

function rowStatusLabel(status: string) {
  if (status === "trading") return "可交易";
  if (status === "paper_only") return "紙上模式";
  if (status === "liquidate_only") return "只減倉";
  if (status === "halted") return "全鎖定";
  if (status === "ok") return "正常";
  if (status === "warn") return "注意";
  if (status === "block") return "阻擋";
  if (status === "blocked_killswitch") return "鎖定";
  if (status === "no_limit_set") return "未設定";
  return status;
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
      {rows.length === 0 && <div className="terminal-note">目前沒有曝險明細。</div>}
      {rows.slice(0, 5).map((row) => (
        <div className="row" key={`${title}-${row.key}`} style={breakdownRowStyle}>
          <span className="tg gold">{row.key}</span>
          <span className="num">{money(row.exposure)}</span>
          <span className="tg muted">{pct(row.utilizationPct)}</span>
          <span className="tg" style={{ color: row.status === "block" ? "var(--tw-up-bright)" : row.status === "warn" ? "var(--gold-bright)" : "var(--tw-dn-bright)" }}>
            {rowStatusLabel(row.status)}
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
          <span style={{ color: "var(--gold-bright)", fontWeight: 700 }}>待啟用</span>
          <span>四層風控總覽</span>
          <span>檢查 {formatTime(result.updatedAt)}</span>
        </div>
        <div className="terminal-note">
          風控總覽資料尚未接上。紙上委託仍會在送出前執行風控預檢；此區待後端總覽資料啟用後會顯示帳戶、策略、個股與盤中四層曝險。
        </div>
      </div>
    );
  }

  const { data } = result;
  const isEmpty = data.positionAttribution.length === 0;
  return (
    <div>
      <div className="tg soft" style={sourceStyle}>
        <span style={{ color: "var(--tw-dn-bright)", fontWeight: 700 }}>即時</span>
        <span>四層風控總覽</span>
        <span>更新 {formatTime(data.generatedAt)}</span>
        <span>交易模式 {rowStatusLabel(data.killSwitchState)}</span>
        <span>紙上閘門 {rowStatusLabel(data.paperGateState)}</span>
      </div>
      {isEmpty && (
        <div className="terminal-note">
          目前沒有部位曝險，仍保留四層限制供送單前檢查。
        </div>
      )}
      <div style={gridStyle}>
        {LAYERS.map((layer) => (
          <RiskCell cell={data.layers[layer]} key={layer} />
        ))}
      </div>
      <details style={detailsStyle}>
        <summary className="tg gold" style={{ cursor: "pointer" }}>主要曝險明細</summary>
        <div style={breakdownGridStyle}>
          <Breakdown
            title="策略曝險"
            rows={data.strategyBreakdown.map((row) => ({
              key: row.strategyTag,
              exposure: row.exposureNtd,
              utilizationPct: row.utilizationPct,
              status: row.status,
            }))}
          />
          <Breakdown
            title="個股曝險"
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
