import type { CSSProperties } from "react";

import type { WatchlistQuoteCell } from "@/lib/api";

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatNumber(value: number) {
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function isStale(updatedAt: string) {
  const time = new Date(updatedAt).getTime();
  return Number.isFinite(time) && Date.now() - time > 30_000;
}

export function QuoteCellRender({ cell, suffix = "" }: { cell: WatchlistQuoteCell; suffix?: string }) {
  if (cell.state === "BLOCKED") {
    return (
      <span
        aria-label={`報價暫停：${cell.reason}`}
        className="tg"
        style={blockedStyle}
        title={`${cell.reason}${cell.lastSeenAt ? ` / 最後 ${formatTime(cell.lastSeenAt)}` : ""}`}
      >
        --
      </span>
    );
  }

  const stale = isStale(cell.updatedAt);
  return (
    <span
      aria-label={`真實報價 ${formatNumber(cell.value)}，更新 ${formatTime(cell.updatedAt)}`}
      className="num"
      style={{ color: stale ? "var(--gold-bright)" : "var(--tw-dn-bright)" }}
      title={`更新 ${formatTime(cell.updatedAt)}${stale ? " / 超過 30 秒未更新" : ""}`}
    >
      {formatNumber(cell.value)}{suffix}
    </span>
  );
}

const blockedStyle: CSSProperties = {
  color: "var(--tw-up-bright)",
  fontWeight: 700,
};
