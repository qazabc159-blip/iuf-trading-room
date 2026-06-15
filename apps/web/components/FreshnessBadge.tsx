/**
 * FreshnessBadge.tsx — 報價新鮮度視覺標示元件
 *
 * freshness_mode 對應的 UX 規則（秒級系統最重要的 UX/風控界線）：
 *   live     — 綠色脈衝圓點 + "即時"
 *   intraday — 藍色靜態圓點 + "盤中"（TWSE MIS 近即時，<= 15s 延遲）
 *   stale    — 灰色警示三角 + "略舊"（age > 2s，不假裝 live）
 *   close    — 青色圓點 + "今日收盤"（盤後 MIS 當日完整收盤，非昨收、非盤中）
 *   eod      — 橘色方塊 + "昨收"（EOD/盤後資料）
 *
 * 用法：
 *   <FreshnessBadge mode="live" />
 *   <FreshnessBadge mode="stale" ageMs={3500} />
 *   <FreshnessBadge mode="eod" compact />
 */

"use client";

import { realtimeFreshnessMode, type FreshnessMode } from "@/lib/realtime-freshness";

const BADGE_CSS = `
@keyframes _fb-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(74,219,136,0.7); }
  70%  { box-shadow: 0 0 0 6px rgba(74,219,136,0); }
  100% { box-shadow: 0 0 0 0 rgba(74,219,136,0); }
}
@media (prefers-reduced-motion: reduce) {
  ._fb-dot-live { animation: none !important; }
}

._fb-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  font-family: var(--mono, "JetBrains Mono", monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  white-space: nowrap;
  user-select: none;
}

/* live — 綠色 */
._fb-badge--live {
  border: 1px solid rgba(74,219,136,0.45);
  background: rgba(74,219,136,0.08);
  color: #4adb88;
}
._fb-dot-live {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #4adb88;
  flex-shrink: 0;
  animation: _fb-pulse 1.8s ease-out infinite;
}

/* intraday — 藍色 */
._fb-badge--intraday {
  border: 1px solid rgba(99,179,237,0.45);
  background: rgba(99,179,237,0.07);
  color: #63b3ed;
}
._fb-dot-intraday {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #63b3ed;
  flex-shrink: 0;
}

/* stale — 灰色 + 警示 */
._fb-badge--stale {
  border: 1px solid rgba(145,160,181,0.35);
  background: rgba(145,160,181,0.06);
  color: #91a0b5;
}
._fb-icon-stale {
  font-size: 10px;
  line-height: 1;
}

/* eod — 橘色/昨收 */
._fb-badge--eod {
  border: 1px solid rgba(226,141,52,0.38);
  background: rgba(226,141,52,0.07);
  color: #c8943f;
}
._fb-dot-eod {
  width: 5px; height: 5px;
  background: #c8943f;
  flex-shrink: 0;
}

/* close — 青色/今日收盤（已收盤但為當日完整收盤價，非昨收、非盤中） */
._fb-badge--close {
  border: 1px solid rgba(96,200,180,0.42);
  background: rgba(96,200,180,0.07);
  color: #54bda9;
}
._fb-dot-close {
  width: 5px; height: 5px;
  background: #54bda9;
  flex-shrink: 0;
}

._fb-age {
  opacity: 0.65;
  font-size: 9px;
  font-weight: 400;
}
`;

function formatAge(ms: number | undefined): string | null {
  if (ms === undefined || ms < 0) return null;
  if (ms < 1000) return null; // < 1s — 不顯示
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return null;
}

export type FreshnessBadgeProps = {
  mode: FreshnessMode;
  /** freshness_ms — 資料距現在幾毫秒（stale 時顯示 age） */
  ageMs?: number;
  /** compact — 只顯示圓點，不顯示文字（用於表格列） */
  compact?: boolean;
  /** data-testid override */
  testId?: string;
};

/**
 * 主要 export — FreshnessBadge
 */
export function FreshnessBadge({ mode, ageMs, compact, testId }: FreshnessBadgeProps) {
  const ageStr = mode === "stale" ? formatAge(ageMs) : null;

  return (
    <>
      <style>{BADGE_CSS}</style>
      {mode === "live" && (
        <span
          className="_fb-badge _fb-badge--live"
          aria-label="即時報價"
          data-testid={testId ?? "freshness-badge-live"}
        >
          <span className="_fb-dot-live" />
          {!compact && "即時"}
        </span>
      )}

      {mode === "intraday" && (
        <span
          className="_fb-badge _fb-badge--intraday"
          aria-label="盤中近即時"
          data-testid={testId ?? "freshness-badge-intraday"}
        >
          <span className="_fb-dot-intraday" />
          {!compact && "盤中"}
        </span>
      )}

      {mode === "stale" && (
        <span
          className="_fb-badge _fb-badge--stale"
          aria-label="資料略舊，請注意"
          data-testid={testId ?? "freshness-badge-stale"}
        >
          <span className="_fb-icon-stale">▲</span>
          {!compact && "略舊"}
          {!compact && ageStr && <span className="_fb-age">{ageStr}</span>}
        </span>
      )}

      {mode === "close" && (
        <span
          className="_fb-badge _fb-badge--close"
          aria-label="今日收盤"
          data-testid={testId ?? "freshness-badge-close"}
        >
          <span className="_fb-dot-close" />
          {!compact && "今日收盤"}
        </span>
      )}

      {mode === "eod" && (
        <span
          className="_fb-badge _fb-badge--eod"
          aria-label="昨收盤後資料"
          data-testid={testId ?? "freshness-badge-eod"}
        >
          <span className="_fb-dot-eod" />
          {!compact && "昨收"}
        </span>
      )}
    </>
  );
}

/**
 * FreshnessBadgeFromState — 從後端 state/source/freshness 直接 render
 * 不需要先建 QuoteEntry（用於沒有 store 的場景）
 */
export function FreshnessBadgeFromState({
  state,
  source,
  freshness,
  updatedAt,
  marketSession,
  referenceReason,
  compact,
}: {
  state?: string;
  source?: string;
  freshness?: string;
  updatedAt?: string;
  marketSession?: string;
  referenceReason?: string;
  compact?: boolean;
}) {
  const mode: FreshnessMode = realtimeFreshnessMode({
    state,
    source,
    freshness,
    updatedAt,
    marketSession,
    referenceReason,
  });

  const ageMs = updatedAt ? Date.now() - Date.parse(updatedAt) : undefined;

  return <FreshnessBadge mode={mode} ageMs={ageMs} compact={compact} />;
}
