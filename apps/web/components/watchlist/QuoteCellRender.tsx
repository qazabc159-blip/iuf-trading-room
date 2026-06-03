import type { CSSProperties } from "react";

import type { WatchlistQuoteCell } from "@/lib/api";
import { FreshnessBadge } from "@/components/FreshnessBadge";
import type { FreshnessMode } from "@/lib/quote-store";

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatNumber(value: number) {
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

/**
 * age > 2s = stale（秒級系統 UX 風控界線）
 * age > 30s = stale (legacy threshold, kept for colour tint)
 */
function ageMs(updatedAt: string): number {
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) return -1;
  return Math.max(0, Date.now() - time);
}

function cellFreshnessMode(cell: WatchlistQuoteCell): FreshnessMode {
  if (cell.state === "BLOCKED") return "eod";
  const age = ageMs(cell.updatedAt);
  if (age < 0) return "eod";
  // > 2s = stale（不假裝 live）
  if (age > 2000) return "stale";
  return "live";
}

export function QuoteCellRender({ cell, suffix = "", showBadge = false }: { cell: WatchlistQuoteCell; suffix?: string; showBadge?: boolean }) {
  if (cell.state === "BLOCKED") {
    return (
      <span
        aria-label={`報價暫停：${cell.reason}`}
        className="tg"
        style={blockedStyle}
        title={`${cell.reason}${cell.lastSeenAt ? ` / 最後 ${formatTime(cell.lastSeenAt)}` : ""}`}
        data-testid="quote-cell-blocked"
      >
        {showBadge && <FreshnessBadge mode="eod" compact testId="watchlist-freshness-badge" />}
        --
      </span>
    );
  }

  const age = ageMs(cell.updatedAt);
  const mode = cellFreshnessMode(cell);
  const isOldStale = age > 30_000;

  return (
    <span
      aria-label={`真實報價 ${formatNumber(cell.value)}，更新 ${formatTime(cell.updatedAt)}`}
      className="num"
      style={{ color: isOldStale ? "var(--gold-bright)" : "var(--tw-dn-bright)", display: "inline-flex", alignItems: "center", gap: 4 }}
      title={`更新 ${formatTime(cell.updatedAt)}${mode === "stale" ? ` / 資料 ${Math.round(age / 1000)}s 前` : ""}`}
      data-testid="quote-cell-live"
    >
      {showBadge && <FreshnessBadge mode={mode} ageMs={age} compact testId="watchlist-freshness-badge" />}
      {formatNumber(cell.value)}{suffix}
    </span>
  );
}

const blockedStyle: CSSProperties = {
  color: "var(--tw-up-bright)",
  fontWeight: 700,
};
