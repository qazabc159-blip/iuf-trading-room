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
    limit: { kind: "觀察清單試算", value: 0, unit: "count" },
    current: 0,
    utilizationPct: advisory.layers[layer] === "block" ? 1 : advisory.layers[layer] === "warn" ? 0.8 : 0,
    warnThresholdPct: 0.8,
    blockThresholdPct: 1,
    reason: advisory.layers[layer] === "no_limit_set" ? "此層風控尚未設定限制" : null,
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
  if (quoteBlocked(row)) return "報價資料不完整，暫時不能帶入委託。";
  if (!row.hypothetical1LotBuyRisk) return "風控試算尚未可用。";
  return "策略想法帶入紙上委託的後端流程尚未啟用，請先到紙上交易頁手動建立。";
}

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  return (
    <div style={tableStyle}>
      <div className="row table-head tg" style={rowStyle}>
        <span>代號</span>
        <span>名稱</span>
        <span>成交</span>
        <span>買價</span>
        <span>賣價</span>
        <span>漲跌%</span>
        <span>風控</span>
        <span>帶入</span>
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
              blockedReason={advisory ? undefined : "此檔風控試算尚未可用。"}
              layers={advisory ? riskLayers(advisory) : null}
              overviewState={advisory ? "LIVE" : "BLOCKED"}
              row={riskRow(row)}
            />
            <span
              aria-label={promoteReason(row)}
              role="status"
              style={disabledButtonStyle}
              title={promoteReason(row)}
            >
              待啟用
            </span>
          </div>
        );
      })}
      {rows.length > 12 && (
        <div className="tg soft" style={{ padding: "8px 0" }}>
          先顯示前 12 檔，共 {rows.length} 檔；排序沿用後端結果。
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
