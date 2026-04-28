"use client";
/**
 * FreshnessBadge — fresh / stale / no_data indicator
 * Ported from sandbox v0.7.0-w3
 * W3 polish: tooltip + endpointUnavailable sub-label + CSS transition
 */

import type { QuoteFreshness } from "@/lib/use-readonly-quote";

interface FreshnessBadgeProps {
  freshness: QuoteFreshness;
  source?: "live" | "mock";
  tooltip?: string;
  endpointUnavailable?: boolean;
  label?: string;
}

const LABEL: Record<QuoteFreshness, string> = {
  fresh:   "LIVE · FRESH",
  stale:   "LIVE · STALE",
  no_data: "NO DATA",
};

export function FreshnessBadge({ freshness, source, tooltip, endpointUnavailable, label: prefixLabel }: FreshnessBadgeProps) {
  const label = source === "mock"
    ? (endpointUnavailable ? "ERR→MOCK" : "MOCK")
    : LABEL[freshness];

  const colorClass = source === "mock"
    ? (endpointUnavailable ? "stale" : "no_data")
    : freshness;

  return (
    <span
      className={`quote-freshness-badge ${colorClass}`}
      title={tooltip}
      data-testid="freshness-badge-state"
    >
      <span>{prefixLabel ? `${prefixLabel} · ` : ""}{label}</span>
      {/* C1.2: touch fallback — show brief sub-label so mobile users see data source state */}
      {endpointUnavailable && (
        <span style={{ fontSize: 8, letterSpacing: "0.10em", color: "var(--night-soft)" }}>
          endpoint unavailable · mock active
        </span>
      )}
    </span>
  );
}
