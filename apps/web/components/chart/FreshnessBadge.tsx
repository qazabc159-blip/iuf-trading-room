"use client";

import type { QuoteFreshness } from "@/lib/use-readonly-quote";

interface FreshnessBadgeProps {
  freshness: QuoteFreshness;
  source?: "live" | "mock";
  tooltip?: string;
  endpointUnavailable?: boolean;
  label?: string;
}

const LABEL: Record<QuoteFreshness, string> = {
  fresh: "LIVE / FRESH",
  stale: "LIVE / STALE",
  no_data: "NO DATA",
};

export function FreshnessBadge({ freshness, source, tooltip, endpointUnavailable, label: prefixLabel }: FreshnessBadgeProps) {
  const label = endpointUnavailable
    ? "BLOCKED"
    : source === "mock"
    ? "MOCK"
    : LABEL[freshness];

  const colorClass = endpointUnavailable
    ? "stale"
    : source === "mock"
    ? "no_data"
    : freshness;

  return (
    <span className={`quote-freshness-badge ${colorClass}`} title={tooltip}>
      <span>{prefixLabel ? `${prefixLabel} / ` : ""}{label}</span>
      {endpointUnavailable && (
        <span style={{ fontSize: 8, letterSpacing: "0.10em", color: "var(--night-soft)" }}>
          endpoint unavailable
        </span>
      )}
    </span>
  );
}
