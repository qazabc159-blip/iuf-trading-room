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
    return row.hypotheticalBlockReason ?? `${layer} would block the next hypothetical lot.`;
  }
  return cell.reason ?? `${layer}: ${cell.status}`;
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
        aria-label={`risk attribution blocked: ${blockedReason ?? "overview unavailable"}`}
        className="tg"
        style={blockedStyle}
        title={blockedReason ?? "Risk overview endpoint is unavailable."}
      >
        ????
      </span>
    );
  }

  if (!row) {
    return (
      <span
        aria-label="risk attribution not returned for this symbol"
        className="tg"
        style={unknownStyle}
        title="The live overview did not include attribution for this symbol."
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
      aria-label={`risk next order code ${text}`}
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
