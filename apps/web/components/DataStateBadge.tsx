/**
 * DataStateBadge.tsx — 全站四態誠實狀態標示元件（C-3）
 *
 * 對應 `reports/product_flow/DAILY_DECISION_FLOW_DESIGN_v1.md` §5 詞彙表，
 * 統一「即時 / 收盤快照 / 延遲・部分 / 無資料」四態的視覺與文案，避免各頁各講各的
 * （例如同樣是收盤資料，有頁面寫「今日收盤」、有頁面寫「略舊」，混淆使用者）。
 *
 * 用法：
 *   <DataStateBadge state="live" />
 *   <DataStateBadge state="close" asOf="2026-07-02" />
 *   <DataStateBadge state="delayed" reason="3/8 檔尚未計價" />
 *   <DataStateBadge state="empty" reason="非交易時段" eta="開盤後自動載入" />
 *
 * 既有頁面若已有等義文案，可用 `label` 覆寫，只借用四態的顏色語彙，不強制改字：
 *   <DataStateBadge state="close" label="資料截至：07/02 13:30" />
 *
 * 無 React hook、無 "use client" — server / client component 都能用。
 */

import { dataStateLabel, dataStateTone, type DataState } from "@/lib/data-state-copy";

export type DataStateBadgeProps = {
  state: DataState;
  /** close 態：資料自身交易日／時間戳（ISO），非現在時間 */
  asOf?: string | null;
  /** delayed / empty 態：為什麼 */
  reason?: string | null;
  /** empty 態：何時會有 */
  eta?: string | null;
  /** 覆寫顯示文字（沿用既有頁面文案時使用，仍套用四態配色） */
  label?: string;
  /** compact：只顯示色點，不顯示文字（表格列 / 密集版面用） */
  compact?: boolean;
  testId?: string;
};

export function DataStateBadge({ state, asOf, reason, eta, label, compact, testId }: DataStateBadgeProps) {
  const tone = dataStateTone(state);
  const text = label ?? dataStateLabel({ state, asOf, reason, eta });

  return (
    <span
      data-testid={testId ?? `data-state-badge-${state}`}
      title={text}
      aria-label={text}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "2px 6px" : "3px 9px",
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        fontSize: compact ? 10 : 11,
        fontWeight: 800,
        borderRadius: 4,
        whiteSpace: "nowrap",
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: state === "empty" ? 2 : "50%",
          background: tone.color,
          flexShrink: 0,
        }}
      />
      {compact ? null : text}
    </span>
  );
}
