/**
 * track-record-disclosure.ts — S1 headline 回測數字揭露判斷邏輯（P0-3 frontend follow-up）
 *
 * `GET /api/v1/lab/strategy/:strategyId/snapshot`（#1216, 2026-07-10）現在會附三個
 * 誠實揭露欄位：isLiveVerifiedTrackRecord / trackRecordType / headlineDisclosureZh。
 * 純函式抽出決策邏輯，供 `components/TrackRecordDisclosure.tsx` render 使用 — 沿用
 * `data-state-copy.ts` / `DataStateBadge.tsx` 既有的「純邏輯 .ts + 純 render .tsx」
 * 分離慣例，讓決策邏輯可以在不需要 JSX transform 的 vitest 環境下直接單元測試
 * （本 repo 的 vitest 設定 tsconfig `jsx: "preserve"`，無法直接 import/render .tsx）。
 */

export type TrackRecordDisclosureResult =
  | { render: false }
  | { render: true; badgeLabel: string; text: string };

const DEFAULT_DISCLOSURE_TEXT = "歷史回測（未經驗證），非策略現況。";
const BADGE_LABEL = "研究回測．未經驗證";

/**
 * 決定是否需要顯示回測揭露，以及顯示的文案。
 *
 * Fail-safe：isLiveVerifiedTrackRecord 為 null/undefined（未知狀態）一律視同
 * false —— 絕不能把「不確定是否驗證過」當成「已驗證」而隱藏揭露。
 */
export function resolveTrackRecordDisclosure(
  isLiveVerifiedTrackRecord: boolean | null | undefined,
  headlineDisclosureZh: string | null | undefined,
): TrackRecordDisclosureResult {
  if (isLiveVerifiedTrackRecord === true) return { render: false };
  const text = headlineDisclosureZh?.trim() || DEFAULT_DISCLOSURE_TEXT;
  return { render: true, badgeLabel: BADGE_LABEL, text };
}
