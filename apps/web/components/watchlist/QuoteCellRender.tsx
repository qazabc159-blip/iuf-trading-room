import type { CSSProperties } from "react";

import type { WatchlistQuoteCell } from "@/lib/api";

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function isStale(updatedAt: string) {
  const time = new Date(updatedAt).getTime();
  return Number.isFinite(time) && Date.now() - time > 30_000;
}

export function QuoteCellRender({ cell, suffix = "" }: { cell: WatchlistQuoteCell; suffix?: string }) {
  if (cell.state === "BLOCKED") {
    return (
      <span
        aria-label={`quote blocked: ${cell.reason}`}
        className="tg"
        style={blockedStyle}
        title={`${cell.reason}${cell.lastSeenAt ? ` / last seen ${formatTime(cell.lastSeenAt)}` : ""}`}
      >
        --
      </span>
    );
  }

  const stale = isStale(cell.updatedAt);
  return (
    <span
      aria-label={`quote live ${formatNumber(cell.value)} updated ${formatTime(cell.updatedAt)}`}
      className="num"
      style={{ color: stale ? "var(--gold-bright)" : "var(--tw-dn-bright)" }}
      title={`updated ${formatTime(cell.updatedAt)}${stale ? " / stale over 30s" : ""}`}
    >
      {formatNumber(cell.value)}{suffix}
    </span>
  );
}

const blockedStyle: CSSProperties = {
  color: "var(--tw-up-bright)",
  fontWeight: 700,
};
