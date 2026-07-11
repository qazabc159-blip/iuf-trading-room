import { resolveTrackRecordDisclosure } from "@/lib/track-record-disclosure";

/**
 * TrackRecordDisclosure.tsx — S1 headline 回測數字揭露元件（P0-3 frontend follow-up）
 *
 * `GET /api/v1/lab/strategy/:strategyId/snapshot`（#1216, 2026-07-10）現在會附
 * 三個誠實揭露欄位：isLiveVerifiedTrackRecord / trackRecordType /
 * headlineDisclosureZh。任何頁面 render headline 報酬／命中率數字前，必須先檢查
 * isLiveVerifiedTrackRecord — 目前三個已知 snapshot（cont_liq_v36 / strategy_002
 * / strategy_003）全部是 false（RESEARCH_FORWARD_OBSERVATION /
 * BACKTESTED_RAW），沒有任何策略已被驗證為真實績效。
 *
 * 樣式比照 `DataStateBadge` 的琥珀語彙（delayed/close tone #fbbf24），但刻意
 * 視覺降權（小字、無高對比色）——不能比真實 F-AUTO SIM 績效更醒目，避免使用者
 * 把回測數字誤認為現況。決策邏輯抽在 `lib/track-record-disclosure.ts`（純函式，
 * 可單元測試；此檔只負責 render）。
 *
 * isLiveVerifiedTrackRecord === true 時完全不 render（無需揭露）。
 */
export function TrackRecordDisclosure({
  isLiveVerifiedTrackRecord,
  headlineDisclosureZh,
  compact,
}: {
  isLiveVerifiedTrackRecord: boolean | null | undefined;
  headlineDisclosureZh: string | null | undefined;
  /** 縮小版：用於空間受限的 compact 表格列 */
  compact?: boolean;
}) {
  const decision = resolveTrackRecordDisclosure(isLiveVerifiedTrackRecord, headlineDisclosureZh);
  if (!decision.render) return null;

  return (
    <div
      data-testid="track-record-disclosure"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        marginTop: compact ? 4 : 8,
        padding: compact ? "4px 7px" : "7px 9px",
        border: "1px solid rgba(251,191,36,0.30)",
        borderRadius: 6,
        background: "rgba(251,191,36,0.06)",
        color: "#b89968",
        fontSize: compact ? 10 : 11,
        lineHeight: 1.45,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          marginTop: 3,
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "#fbbf24",
        }}
      />
      <span>
        <b style={{ color: "#d4a94f", fontWeight: 800 }}>{decision.badgeLabel}</b>
        {"／"}
        {decision.text}
      </span>
    </div>
  );
}
