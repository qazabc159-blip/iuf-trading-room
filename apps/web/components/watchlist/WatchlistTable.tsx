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
    limit: { kind: "watchlist-preview", value: 0, unit: "count" },
    current: 0,
    utilizationPct: advisory.layers[layer] === "block" ? 1 : advisory.layers[layer] === "warn" ? 0.8 : 0,
    warnThresholdPct: 0.8,
    blockThresholdPct: 1,
    reason: advisory.layers[layer] === "no_limit_set" ? "此風控層尚未設定限制" : null,
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
  if (quoteBlocked(row)) return "報價資料尚未完整，不能轉入模擬委託。";
  if (!row.hypothetical1LotBuyRisk) return "風控預覽尚未可用。";
  return "轉入模擬委託仍暫停；需完成策略交接、風控預覽與操作者確認。";
}

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  return (
    <div style={tableStyle}>
      <div className="row table-head tg watchlist-row" style={rowStyle}>
        <span>代號</span>
        <span>名稱</span>
        <span>成交</span>
        <span>買價</span>
        <span>賣價</span>
        <span>漲跌%</span>
        <span>風控</span>
        <span>轉單</span>
      </div>
      {rows.slice(0, 12).map((row) => {
        const advisory = row.hypothetical1LotBuyRisk;
        return (
          <div className="row watchlist-row" key={row.symbol} style={rowStyle}>
            <Link className="tg gold" href={`/companies/${row.symbol}`}>{row.symbol}</Link>
            <span className="tc soft" style={nameStyle}>{row.symbolName ?? "--"}</span>
            <QuoteCellRender cell={row.last} />
            <QuoteCellRender cell={row.bid} />
            <QuoteCellRender cell={row.ask} />
            <QuoteCellRender cell={row.changePct} suffix="%" />
            <PositionRiskBadge
              blockedReason={advisory ? undefined : "風控預覽尚未可用"}
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
              暫停
            </span>
          </div>
        );
      })}
      {rows.length > 12 && (
        <div className="tg soft" style={{ padding: "12px 0" }}>
          目前先顯示 12 檔，共 {rows.length} 檔；完整清單待正式篩選器接上。
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
  gridTemplateColumns: "62px minmax(116px, 1fr) 72px 72px 72px 64px 78px 78px",
  gap: 10,
  padding: "12px 0",
};

const nameStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const disabledButtonStyle: CSSProperties = {
  minHeight: 28,
  border: "1px solid var(--exec-rule-strong)",
  background: "transparent",
  color: "var(--exec-soft)",
  cursor: "not-allowed",
  fontFamily: "var(--sans-tc)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
