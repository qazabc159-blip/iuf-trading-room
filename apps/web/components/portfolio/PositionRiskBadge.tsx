import type { CSSProperties } from "react";

import type { PositionRiskRow, RiskLayerCell, RiskLayerName } from "@/lib/api";

type Layers = Record<RiskLayerName, RiskLayerCell>;
type OverviewState = "LIVE" | "BLOCKED";

const LAYERS: RiskLayerName[] = ["account", "strategy", "symbol", "session"];

function statusChar(status: RiskLayerCell["status"]) {
  if (status === "ok") return "O";
  if (status === "warn") return "W";
  if (status === "block") return "B";
  if (status === "no_limit_set") return "N";
  return "K";
}

function titleFor(layer: RiskLayerName, cell: RiskLayerCell, row: PositionRiskRow) {
  if (row.hypotheticalBlockingLayer === layer) {
    return row.hypotheticalBlockReason ?? `${layerName(layer)}會阻擋下一筆試算委託。`;
  }
  return cell.reason ?? `${layerName(layer)}：${statusText(cell.status)}`;
}

function layerName(layer: RiskLayerName) {
  if (layer === "account") return "帳戶";
  if (layer === "strategy") return "策略";
  if (layer === "symbol") return "個股";
  return "盤中";
}

function statusText(status: RiskLayerCell["status"]) {
  if (status === "ok") return "正常";
  if (status === "warn") return "注意";
  if (status === "block") return "阻擋";
  if (status === "blocked_killswitch") return "交易鎖定";
  return "未設定";
}

export function PositionRiskBadge({
  overviewState,
  layers,
  row,
  blockedReason,
}: {
  overviewState: OverviewState;
  layers: Layers | null;
  row: PositionRiskRow | null;
  blockedReason?: string;
}) {
  if (overviewState === "BLOCKED" || !layers) {
    return (
      <span
        aria-label={`風控歸因暫停：${blockedReason ?? "總覽資料尚未啟用"}`}
        className="tg"
        style={blockedStyle}
        title={blockedReason ?? "風控總覽資料尚未啟用。"}
      >
        ????
      </span>
    );
  }

  if (!row) {
    return (
      <span
        aria-label="此股票尚未回傳風控歸因"
        className="tg"
        style={unknownStyle}
        title="後端總覽尚未提供此股票的風控歸因。"
      >
        ----
      </span>
    );
  }

  const chars = LAYERS.map((layer) => (
    row.hypotheticalBlockingLayer === layer ? "B" : statusChar(layers[layer].status)
  ));
  const text = chars.join("");
  const hasBlock = chars.includes("B") || chars.includes("K");
  const hasWarn = chars.includes("W");
  const color = hasBlock ? "var(--tw-up-bright)" : hasWarn ? "var(--gold-bright)" : "var(--tw-dn-bright)";
  const title = LAYERS.map((layer, index) => `${chars[index]} ${titleFor(layer, layers[layer], row)}`).join(" / ");

  return (
    <span
      aria-label={`下一筆委託風控代碼 ${text}`}
      className="tg"
      style={{ ...badgeStyle, color }}
      title={title}
    >
      [{text}]
    </span>
  );
}

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 22,
  minWidth: 58,
  border: "1px solid var(--exec-rule-strong)",
  background: "rgba(255,255,255,0.018)",
  fontWeight: 700,
};

const blockedStyle: CSSProperties = {
  ...badgeStyle,
  color: "var(--tw-up-bright)",
};

const unknownStyle: CSSProperties = {
  ...badgeStyle,
  color: "var(--exec-soft)",
};
