import Link from "next/link";
import type { CSSProperties } from "react";

import { PositionRiskBadge } from "@/components/portfolio/PositionRiskBadge";
import type { PositionRiskRow, RiskLayerCell, RiskLayerName, WatchlistRiskAdvisoryPreview, WatchlistRow } from "@/lib/api";
import { QuoteCellRender } from "./QuoteCellRender";

const LAYERS: RiskLayerName[] = ["account", "strategy", "symbol", "session"];

function toRiskCell(layer: RiskLayerName, advisory: WatchlistRiskAdvisoryPreview): RiskLayerCell {
  return {
    layer,
    status: advisory.layers[layer],
    limit: { kind: "watchlist advisory", value: 0, unit: "count" },
    current: 0,
    utilizationPct: advisory.layers[layer] === "block" ? 1 : advisory.layers[layer] === "warn" ? 0.8 : 0,
    warnThresholdPct: 0.8,
    blockThresholdPct: 1,
    reason: advisory.layers[layer] === "no_limit_set" ? `${layer} limit not set` : null,
    topContributors: [],
  };
}

function riskLayers(advisory: WatchlistRiskAdvisoryPreview): Record<RiskLayerName, RiskLayerCell> {
  return {
    account: toRiskCell("account", advisory),
    strategy: toRiskCell("strategy", advisory),
    symbol: toRiskCell("symbol", advisory),
    session: toRiskCell("session", advisory),
  };
}

function riskRow(row: WatchlistRow): PositionRiskRow | null {
  if (!row.hypothetical1LotBuyRisk) return null;
  return {
    symbol: row.symbol,
    qtyLots: 1,
    marketValueNtd: row.last.state === "LIVE" ? row.last.value * 1000 : 0,
    unrealizedPnlNtd: 0,
    hypotheticalBlockingLayer: row.hypothetical1LotBuyRisk.hypotheticalBlockingLayer ?? "none",
    hypotheticalBlockReason: row.promoteBlockedReason,
  };
}

function quoteBlocked(row: WatchlistRow) {
  return row.last.state === "BLOCKED" || row.bid.state === "BLOCKED" || row.ask.state === "BLOCKED" || row.changePct.state === "BLOCKED";
}

function promoteReason(row: WatchlistRow) {
  if (row.promoteBlockedReason) return row.promoteBlockedReason;
  if (quoteBlocked(row)) return "BLOCKED: one or more quote cells are unavailable.";
  if (!row.hypothetical1LotBuyRisk) return "BLOCKED: risk advisory unavailable.";
  return "BLOCKED: Contract 4 promote-to-paper route is not wired yet; use /portfolio paper ticket manually.";
}

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  return (
    <div style={tableStyle}>
      <div className="row table-head tg" style={rowStyle}>
        <span>SYMBOL</span>
        <span>NAME</span>
        <span>LAST</span>
        <span>BID</span>
        <span>ASK</span>
        <span>CHG%</span>
        <span>RISK</span>
        <span>PROMOTE</span>
      </div>
      {rows.slice(0, 12).map((row) => {
        const advisory = row.hypothetical1LotBuyRisk;
        return (
          <div className="row" key={row.symbol} style={rowStyle}>
            <Link className="tg gold" href={`/companies/${row.symbol}`}>{row.symbol}</Link>
            <span className="tc soft" style={nameStyle}>{row.symbolName ?? "--"}</span>
            <QuoteCellRender cell={row.last} />
            <QuoteCellRender cell={row.bid} />
            <QuoteCellRender cell={row.ask} />
            <QuoteCellRender cell={row.changePct} suffix="%" />
            <PositionRiskBadge
              blockedReason={advisory ? undefined : "Risk advisory failed for this watchlist row."}
              layers={advisory ? riskLayers(advisory) : null}
              overviewState={advisory ? "LIVE" : "BLOCKED"}
              row={riskRow(row)}
            />
            <button
              aria-disabled="true"
              disabled
              style={disabledButtonStyle}
              title={promoteReason(row)}
              type="button"
            >
              PROMOTE
            </button>
          </div>
        );
      })}
      {rows.length > 12 && (
        <div className="tg soft" style={{ padding: "8px 0" }}>
          Showing first 12 of {rows.length}; backend order preserved.
        </div>
      )}
    </div>
  );
}

const tableStyle: CSSProperties = {
  maxHeight: 520,
  overflowY: "auto",
};

const rowStyle: CSSProperties = {
  gridTemplateColumns: "58px minmax(96px, 1fr) 68px 68px 68px 58px 72px 78px",
  gap: 8,
  padding: "9px 0",
};

const nameStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const disabledButtonStyle: CSSProperties = {
  minHeight: 24,
  border: "1px solid var(--exec-rule-strong)",
  background: "transparent",
  color: "var(--exec-soft)",
  cursor: "not-allowed",
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0,
};
